import type {
  WorkspaceRecord,
  WorkspaceRecords,
} from '@emdash/core/runtimes/workspace-registry/api';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  createWorkspaceRegistry,
  isAnnotatedWorkspace,
  liveWorkspaces,
  workspaceRegistryTable as workspaces,
  type WorkspaceRegistry,
} from '@core/features/workspaces/api/node/registry';
import type { AppDb, DrizzleTx } from '@core/services/app-db/node/db';
import { appDbPokes } from '@core/services/app-db/node/pokes';
import { projects, tasks, type WorkspaceRow } from '@core/services/app-db/node/schema';

export type WorkspaceHostIdentity = Readonly<{
  location: 'local' | 'remote';
  sshConnectionId: string | null;
}>;

export interface ApplyWorkspaceRegistrySnapshotInput {
  db: AppDb;
  host: WorkspaceHostIdentity;
  records: WorkspaceRecords;
  /** Epoch-ms observation stamp; defaults to now. */
  observedAt?: number;
}

export interface ApplyWorkspaceRegistrySnapshotResult {
  adopted: number;
  refreshed: number;
  markedMissing: number;
  untracked: number;
}

/**
 * Converges the desktop workspace mirror toward one host's registry (ADR 0005): every
 * `records` delivery applies as a single idempotent transaction through the registry
 * sole-writer verbs — refresh matches by id, adopt unknowns, sweep unmatched rows
 * through the missing rules. Observations (the git block, create outcome, runtime
 * overlay included) overwrite wholesale; annotations are never touched. Callers must
 * only invoke this after a successful read: an unreachable host sweeps nothing.
 */
export async function applyWorkspaceRegistrySnapshot(
  input: ApplyWorkspaceRegistrySnapshotInput
): Promise<ApplyWorkspaceRegistrySnapshotResult> {
  const now = new Date().toISOString();
  const registry = createWorkspaceRegistry(input.db, { now: () => now });
  const result = input.db.transaction((tx) =>
    applyWorkspaceRegistrySnapshotTx(tx, input, registry, now)
  );
  appDbPokes.workspaces.poke({});
  return result;
}

function applyWorkspaceRegistrySnapshotTx(
  tx: DrizzleTx,
  input: ApplyWorkspaceRegistrySnapshotInput,
  registry: WorkspaceRegistry,
  now: string
): ApplyWorkspaceRegistrySnapshotResult {
  const observedAt = input.observedAt ?? Date.now();
  const hostRows = loadLiveHostRows(tx, input.host);
  const annotations = loadAnnotations(
    tx,
    hostRows.map((row) => row.id)
  );
  const counts: ApplyWorkspaceRegistrySnapshotResult = {
    adopted: 0,
    refreshed: 0,
    markedMissing: 0,
    untracked: 0,
  };

  const seen = new Set<string>();
  for (const record of Object.values(input.records)) {
    seen.add(record.id);
    // Matching is a primary-key lookup on the preserved workspace UUID — the host
    // already resolved moves and adoptions; no path or admin-name matching here.
    const existing = registry.getLive(record.id, tx);
    if (existing === undefined) {
      registry.adopt(
        {
          id: record.id,
          type: input.host.location === 'remote' ? 'project-ssh' : 'local',
          ...observationFor(record, input.host, observedAt),
          createdAt: new Date(record.createdAt).toISOString(),
        },
        tx
      );
      counts.adopted += 1;
      continue;
    }
    registry.refresh(record.id, observationFor(record, input.host, observedAt), tx);
    counts.refreshed += 1;
  }

  for (const row of hostRows) {
    if (seen.has(row.id)) continue;
    const annotated = isAnnotatedWorkspace({
      config: row.config,
      hasTaskLink: annotations.taskWorkspaceIds.has(row.id),
      isProjectRepository: annotations.projectRepositoryWorkspaceIds.has(row.id),
    });
    if (annotated) {
      // Annotated rows stay visible as missing until the user acts.
      registry.refresh(
        row.id,
        {
          observedStatus: 'missing',
          observedAt,
          lastObservedAt: new Date(observedAt).toISOString(),
        },
        tx
      );
      counts.markedMissing += 1;
    } else {
      // Pure mirror entries follow the mirror.
      registry.untrack([row.id], now, undefined, tx);
      counts.untracked += 1;
    }
  }

  return counts;
}

function loadLiveHostRows(tx: DrizzleTx, host: WorkspaceHostIdentity): WorkspaceRow[] {
  const hostIdentity =
    host.sshConnectionId === null
      ? isNull(workspaces.sshConnectionId)
      : eq(workspaces.sshConnectionId, host.sshConnectionId);
  return tx
    .select()
    .from(workspaces)
    .where(and(liveWorkspaces(), eq(workspaces.location, host.location), hostIdentity))
    .all();
}

function loadAnnotations(tx: DrizzleTx, workspaceIds: string[]) {
  if (workspaceIds.length === 0) {
    return {
      taskWorkspaceIds: new Set<string>(),
      projectRepositoryWorkspaceIds: new Set<string>(),
    };
  }
  const taskRows = tx
    .select({ workspaceId: tasks.workspaceId })
    .from(tasks)
    .where(inArray(tasks.workspaceId, workspaceIds))
    .all();
  const projectRows = tx
    .select({ workspaceId: projects.repositoryWorkspaceId })
    .from(projects)
    .where(inArray(projects.repositoryWorkspaceId, workspaceIds))
    .all();
  return {
    taskWorkspaceIds: new Set(taskRows.flatMap((row) => (row.workspaceId ? [row.workspaceId] : []))),
    projectRepositoryWorkspaceIds: new Set(
      projectRows.flatMap((row) => (row.workspaceId ? [row.workspaceId] : []))
    ),
  };
}

function observationFor(record: WorkspaceRecord, host: WorkspaceHostIdentity, observedAt: number) {
  return {
    kind: record.kind,
    path: record.path,
    parentId: record.parentId,
    origin: record.origin,
    observedStatus: record.observedStatus,
    observedGit: record.git === null ? null : { version: '1' as const, ...record.git },
    lastCreateOutcome:
      record.lastCreateOutcome === null
        ? null
        : { version: '1' as const, ...record.lastCreateOutcome },
    // Wholesale-refreshed: a daemon restart delivers runtime null, clearing the column.
    runtimeOverlay: record.runtime === null ? null : { version: '1' as const, ...record.runtime },
    lastActivatedAt: record.lastActivatedAt,
    observedAt,
    // Legacy read paths keep working until read rewiring retires these columns.
    observedGitBranch: record.git?.branch ?? null,
    linesAdded: record.git?.diffStats?.added ?? null,
    linesDeleted: record.git?.diffStats?.deleted ?? null,
    lastObservedAt: new Date(observedAt).toISOString(),
    location: host.location,
    sshConnectionId: host.sshConnectionId,
  };
}
