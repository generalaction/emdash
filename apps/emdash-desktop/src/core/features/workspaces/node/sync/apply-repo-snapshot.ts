import { randomUUID } from 'node:crypto';
import { formatAbsolute } from '@emdash/core/primitives/path/api';
import type { WorkspaceHostRepoSnapshot } from '@emdash/core/runtimes/workspace-host/api';
import { and, eq, inArray, or } from 'drizzle-orm';
import {
  createWorkspaceRegistry,
  isAnnotatedWorkspace,
  liveWorkspaces,
  workspaceRegistryTable as workspaces,
  type WorkspaceRegistry,
} from '@core/features/workspaces/api/node/registry';
import type { WorkspaceObservedData } from '@core/primitives/workspaces/api';
import type { AppDb, DrizzleTx } from '@core/services/app-db/node/db';
import { appDbPokes } from '@core/services/app-db/node/pokes';
import {
  projects,
  tasks,
  type WorkspaceInsert,
  type WorkspaceRow,
} from '@core/services/app-db/node/schema';

export type RepositoryWorkspaceRow = Pick<
  WorkspaceRow,
  'id' | 'path' | 'location' | 'sshConnectionId'
>;

export interface ApplyRepoSnapshotInput {
  db: AppDb;
  repository: RepositoryWorkspaceRow;
  snapshot: WorkspaceHostRepoSnapshot;
  desktopObservedAt?: string;
  projectId?: string;
}

export interface ApplyRepoSnapshotResult {
  adopted: number;
  refreshed: number;
  relinked: number;
  markedMissing: number;
  untracked: number;
}

type ActiveWorkspaceRow = WorkspaceRow & {
  hasTaskLink: boolean;
  isProjectRepository: boolean;
};

export async function applyRepoSnapshot(
  input: ApplyRepoSnapshotInput
): Promise<ApplyRepoSnapshotResult> {
  const now = new Date().toISOString();
  const registry = createWorkspaceRegistry(input.db, { now: () => now });
  const result = input.db.transaction((tx) => applyRepoSnapshotTx(tx, input, registry, now));
  appDbPokes.workspaces.poke({ projectId: input.projectId });
  return result;
}

function applyRepoSnapshotTx(
  tx: DrizzleTx,
  input: ApplyRepoSnapshotInput,
  registry: WorkspaceRegistry,
  now: string
): ApplyRepoSnapshotResult {
  const observedAt = new Date(input.snapshot.scannedAt).toISOString();
  const desktopObservedAt = input.desktopObservedAt ?? now;
  const activeRows = loadActiveRows(tx, input.repository.id);
  const annotations = loadAnnotations(
    tx,
    activeRows.map((row) => row.id)
  );
  const rows: ActiveWorkspaceRow[] = activeRows.map((row) => ({
    ...row,
    hasTaskLink: annotations.taskWorkspaceIds.has(row.id),
    isProjectRepository: annotations.projectRepositoryWorkspaceIds.has(row.id),
  }));

  const byPath = new Map(rows.flatMap((row) => (row.path ? [[row.path, row]] : [])));
  const byAdminName = new Map(
    rows.flatMap((row) => {
      const adminName = row.observedData?.adminName;
      return adminName ? [[adminName, row]] : [];
    })
  );
  const matched = new Set<string>();
  const counts: ApplyRepoSnapshotResult = {
    adopted: 0,
    refreshed: 0,
    relinked: 0,
    markedMissing: 0,
    untracked: 0,
  };

  registry.refresh(
    input.repository.id,
    {
      observedStatus: collapseStatus(input.snapshot.repository.status),
      observedData: input.snapshot.repository.corruptionReason
        ? {
            version: '1',
            corruptionReason: input.snapshot.repository.corruptionReason,
            desktopObservedAt,
          }
        : { version: '1', desktopObservedAt },
      lastObservedAt: observedAt,
    },
    tx
  );

  for (const observation of input.snapshot.worktrees) {
    const path = formatAbsolute(observation.path);
    const observedData = observedDataFor(observation, desktopObservedAt);
    let row = byPath.get(path);
    if (!row && observation.adminName) {
      row = byAdminName.get(observation.adminName);
      if (row && row.path !== path) {
        registry.refresh(row.id, { path, lastObservedAt: observedAt }, tx);
        row = { ...row, path };
        byPath.set(path, row);
        counts.relinked += 1;
      }
    }

    if (!row) {
      const inserted = adoptWorktree(
        registry,
        tx,
        input.repository,
        path,
        observation,
        observedAt,
        desktopObservedAt,
        now
      );
      rows.push(inserted);
      byPath.set(path, inserted);
      if (observation.adminName) byAdminName.set(observation.adminName, inserted);
      matched.add(inserted.id);
      counts.adopted += 1;
      continue;
    }

    matched.add(row.id);
    registry.refresh(
      row.id,
      {
        observedStatus: collapseStatus(observation.status),
        observedGitBranch: observation.branch,
        observedData,
        lastObservedAt: observedAt,
      },
      tx
    );
    counts.refreshed += 1;
  }

  for (const row of rows) {
    if (matched.has(row.id)) continue;
    if (row.id === input.repository.id) continue;

    if (isAnnotatedWorkspace(row)) {
      registry.refresh(
        row.id,
        {
          observedStatus: 'missing',
          observedData: {
            ...row.observedData,
            version: '1',
            desktopObservedAt,
          },
          lastObservedAt: observedAt,
        },
        tx
      );
      counts.markedMissing += 1;
    } else {
      registry.untrack(
        [row.id],
        now,
        {
          observedStatus: 'missing',
          observedData: {
            ...row.observedData,
            version: '1',
            desktopObservedAt,
          },
          lastObservedAt: observedAt,
        },
        tx
      );
      counts.untracked += 1;
    }
  }

  return counts;
}

function loadActiveRows(tx: DrizzleTx, repositoryWorkspaceId: string): WorkspaceRow[] {
  return tx
    .select()
    .from(workspaces)
    .where(
      and(
        liveWorkspaces(),
        or(eq(workspaces.id, repositoryWorkspaceId), eq(workspaces.parentId, repositoryWorkspaceId))
      )
    )
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
    taskWorkspaceIds: new Set(
      taskRows.flatMap((row) => (row.workspaceId ? [row.workspaceId] : []))
    ),
    projectRepositoryWorkspaceIds: new Set(
      projectRows.flatMap((row) => (row.workspaceId ? [row.workspaceId] : []))
    ),
  };
}

function adoptWorktree(
  registry: WorkspaceRegistry,
  tx: DrizzleTx,
  repository: RepositoryWorkspaceRow,
  path: string,
  observation: WorkspaceHostRepoSnapshot['worktrees'][number],
  observedAt: string,
  desktopObservedAt: string,
  now: string
): ActiveWorkspaceRow {
  const values: WorkspaceInsert = {
    id: randomUUID(),
    type: repository.location === 'remote' ? 'project-ssh' : 'local',
    kind: 'worktree',
    location: repository.location,
    sshConnectionId: repository.sshConnectionId,
    parentId: repository.id,
    path,
    config: null,
    observedStatus: collapseStatus(observation.status),
    observedGitBranch: observation.branch,
    observedData: observedDataFor(observation, desktopObservedAt),
    lastObservedAt: observedAt,
    createdAt: now,
    updatedAt: now,
    untrackedAt: null,
  };
  return {
    ...registry.adopt(values, tx),
    hasTaskLink: false,
    isProjectRepository: false,
  };
}

/** The mirror collapsed 'corrupted' into 'missing' (ADR 0005); the reason survives in observedData. */
function collapseStatus(status: 'present' | 'corrupted'): 'present' | 'missing' {
  return status === 'corrupted' ? 'missing' : status;
}

function observedDataFor(
  observation: WorkspaceHostRepoSnapshot['worktrees'][number],
  desktopObservedAt: string
): WorkspaceObservedData {
  return {
    version: '1',
    desktopObservedAt,
    ...(observation.adminName ? { adminName: observation.adminName } : {}),
    ...(observation.dirty !== undefined ? { dirty: observation.dirty } : {}),
    ...(observation.diffStats ? { diffStats: observation.diffStats } : {}),
    ...(observation.ahead !== undefined ? { ahead: observation.ahead } : {}),
    ...(observation.behind !== undefined ? { behind: observation.behind } : {}),
    ...(observation.corruptionReason ? { corruptionReason: observation.corruptionReason } : {}),
  };
}
