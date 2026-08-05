import { randomUUID } from 'node:crypto';
import {
  hostRef,
  isLocalHostRef,
  LOCAL_HOST_REF,
  type HostRef,
} from '@emdash/core/primitives/host/api';
import type { WorkspaceRecord } from '@emdash/core/runtimes/workspace-registry/api';
import type { HostRuntimesClient, RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import { err, type Result } from '@emdash/shared';
import { createController, type Controller } from '@emdash/wire/api';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  createWorkspaceRegistry,
  liveWorkspaces,
  workspaceRegistryTable as workspaces,
} from '@core/features/workspaces/api/node/registry';
import {
  workspaceRegistryWireContract,
  type ListWorkspacesInput,
} from '@core/features/workspaces/api/registry-wire-contract';
import { mirrorObservationFromRecord } from '@core/features/workspaces/node/sync/apply-workspace-registry-snapshot';
import type { WorkspaceConfig, WorkspaceMirrorRow } from '@core/primitives/workspaces/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { appDbPokes } from '@core/services/app-db/node/pokes';
import { projects, tasks, type WorkspaceRow } from '@core/services/app-db/node/schema';

export type CreateWorkspaceRegistryWireControllerOptions = {
  db: AppDb;
  runtimes: RuntimeBroker;
  /** Test seam; production mints random UUIDs for the create verbs. */
  mintId?: () => string;
};

/**
 * The consolidated renderer workspace API (ADR 0005): reads serve from the mirror,
 * verbs pass through 1:1 to the host registry runtime resolved by host ref. A verb
 * against an unreachable host returns the broker's typed resolve error with no side
 * effects — nothing is queued, ever. Create success upserts the mirror row immediately
 * (with the client-owned config annotation) so links can attach before sync catches up.
 */
export function createWorkspaceRegistryWireController(
  options: CreateWorkspaceRegistryWireControllerOptions
): Controller {
  const mintId = options.mintId ?? randomUUID;
  const withRegistry = async <T, E>(
    host: HostRef,
    work: (registry: HostRuntimesClient['workspaceRegistry']) => Promise<Result<T, E>>
  ) => {
    const client = await options.runtimes.client(host);
    if (!client.success) return err(client.error);
    return work(client.data.workspaceRegistry);
  };

  return createController(workspaceRegistryWireContract, {
    listWorkspaces: (input) => listWorkspaces(options.db, input),

    createWorkspace: ({ host, path, config }) =>
      withRegistry(host, async (registry) => {
        const result = await registry.createWorkspace({ id: mintId(), path });
        if (result.success) upsertMirrorRow(options.db, host, result.data, config);
        return result;
      }),

    createWorktree: ({ host, config, ...spec }) =>
      withRegistry(host, async (registry) => {
        const result = await registry.createWorktree({
          id: mintId(),
          repositoryId: spec.repositoryId,
          branch: spec.branch,
          baseRef: spec.baseRef,
          path: spec.path,
          preservePatterns: spec.preservePatterns ?? [],
          pushBranch: spec.pushBranch ?? false,
        });
        if (result.success) upsertMirrorRow(options.db, host, result.data, config);
        return result;
      }),

    activateWorkspace: ({ host, workspaceId }) =>
      withRegistry(host, (registry) => registry.activateWorkspace({ id: workspaceId })),

    deactivateWorkspace: ({ host, workspaceId }) =>
      withRegistry(host, (registry) => registry.deactivateWorkspace({ id: workspaceId })),

    deleteWorkspace: ({ host, workspaceId }) =>
      withRegistry(host, (registry) => registry.deleteWorkspace({ id: workspaceId })),

    deleteWorktree: ({ host, workspaceId, deleteBranch }) =>
      withRegistry(host, (registry) =>
        registry.deleteWorktree({ id: workspaceId, deleteBranch: deleteBranch ?? false })
      ),

    refresh: ({ host, workspaceId }) =>
      withRegistry(host, (registry) =>
        registry.refresh(workspaceId === undefined ? {} : { id: workspaceId })
      ),

    untrackWorkspace: async ({ workspaceId }) => {
      createWorkspaceRegistry(options.db).untrack([workspaceId], new Date().toISOString());
      appDbPokes.workspaces.poke({});
    },
  });
}

async function listWorkspaces(
  db: AppDb,
  input: ListWorkspacesInput
): Promise<WorkspaceMirrorRow[]> {
  const tracking = input.includeUntracked ? undefined : liveWorkspaces();
  const rows =
    'host' in input.scope
      ? db
          .select()
          .from(workspaces)
          .where(and(tracking, hostScopeFilter(input.scope.host)))
          .all()
      : listProjectRows(db, input.scope.projectId, tracking);
  return rows.map(toMirrorRow);
}

function hostScopeFilter(host: HostRef) {
  return isLocalHostRef(host)
    ? and(eq(workspaces.location, 'local'), isNull(workspaces.sshConnectionId))
    : and(eq(workspaces.location, 'remote'), eq(workspaces.sshConnectionId, host.id));
}

function listProjectRows(
  db: AppDb,
  projectId: string,
  tracking: ReturnType<typeof liveWorkspaces> | undefined
): WorkspaceRow[] {
  const taskLinked = db
    .select({ workspaceId: tasks.workspaceId })
    .from(tasks)
    .where(eq(tasks.projectId, projectId))
    .all()
    .flatMap((row) => (row.workspaceId ? [row.workspaceId] : []));
  const [project] = db
    .select({ repositoryWorkspaceId: projects.repositoryWorkspaceId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .all();
  const ids = [
    ...new Set([
      ...taskLinked,
      ...(project?.repositoryWorkspaceId ? [project.repositoryWorkspaceId] : []),
    ]),
  ];
  if (ids.length === 0) return [];
  return db
    .select()
    .from(workspaces)
    .where(and(tracking, inArray(workspaces.id, ids)))
    .all();
}

function toMirrorRow(row: WorkspaceRow): WorkspaceMirrorRow {
  return {
    id: row.id,
    host: decodeHost(row),
    kind: row.kind,
    path: row.path,
    parentId: row.parentId,
    origin: row.origin,
    config: row.config,
    observedStatus: row.observedStatus,
    observedGit: row.observedGit,
    lastCreateOutcome: row.lastCreateOutcome,
    runtimeOverlay: row.runtimeOverlay,
    lastActivatedAt: row.lastActivatedAt,
    observedAt: row.observedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    untrackedAt: row.untrackedAt,
  };
}

/** Identity-lost rows (deleted SSH connection, no location) decode to null, never local. */
function decodeHost(row: WorkspaceRow): HostRef | null {
  if (row.location === 'local' && row.sshConnectionId === null) return LOCAL_HOST_REF;
  if (row.location === 'remote' && row.sshConnectionId !== null) {
    return hostRef('remote', row.sshConnectionId);
  }
  return null;
}

/**
 * Create success writes the mirror row immediately: register (with the client-owned
 * config annotation) when unknown, refresh + annotate when the id already exists —
 * idempotent with the sync path, which converges the same row from `records`.
 */
function upsertMirrorRow(
  db: AppDb,
  host: HostRef,
  record: WorkspaceRecord,
  config: WorkspaceConfig | undefined
): void {
  const registry = createWorkspaceRegistry(db);
  const hostIdentity = isLocalHostRef(host)
    ? { location: 'local' as const, sshConnectionId: null }
    : { location: 'remote' as const, sshConnectionId: host.id };
  const observation = mirrorObservationFromRecord(record, hostIdentity, Date.now());
  const existing = registry.getLive(record.id);
  if (existing === undefined) {
    registry.register({
      id: record.id,
      type: hostIdentity.location === 'remote' ? 'project-ssh' : 'local',
      ...observation,
      config: config ?? null,
      createdAt: new Date(record.createdAt).toISOString(),
    });
  } else {
    registry.refresh(record.id, observation);
    if (config !== undefined) registry.annotate(record.id, { config });
  }
  appDbPokes.workspaces.poke({});
}
