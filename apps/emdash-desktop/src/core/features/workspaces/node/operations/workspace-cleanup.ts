import { err, ok, type Result } from '@emdash/shared';
import { and, eq, isNull, notExists } from 'drizzle-orm';
import {
  createWorkspaceRegistry,
  liveWorkspaces,
  workspaceRegistryTable as workspaces,
} from '@core/features/workspaces/api/node/registry';
import type {
  WorkspaceCleanupCandidate,
  WorkspaceCleanupPreview,
} from '@core/features/workspaces/api/registry-wire-contract';
import type { AppDb, DrizzleTx } from '@core/services/app-db/node/db';
import { compactDatabase, getDatabaseSpace } from '@core/services/app-db/node/maintenance';
import { appDbPokes } from '@core/services/app-db/node/pokes';
import { projects, tasks } from '@core/services/app-db/node/schema';

/**
 * Live worktree rows the host reports as missing that nothing still needs: no pending
 * deletion (those keep the Retry / Untrack-anyway flow, ADR 0006), not a project's
 * repository row, and no open task — every linked task is archived or deleted.
 * Untracking these is the bulk form of the per-row untrack: the durable untrack keeps
 * sync from resurrecting them, and host files and branches are left alone.
 */
export function findCleanableMissingWorktrees(db: AppDb | DrizzleTx): WorkspaceCleanupCandidate[] {
  const openTaskLink = db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(eq(tasks.workspaceId, workspaces.id), isNull(tasks.archivedAt), isNull(tasks.deletedAt))
    );
  const projectRepositoryLink = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.repositoryWorkspaceId, workspaces.id));

  return db
    .select({ workspaceId: workspaces.id, path: workspaces.path })
    .from(workspaces)
    .where(
      and(
        liveWorkspaces(),
        eq(workspaces.kind, 'worktree'),
        eq(workspaces.observedStatus, 'missing'),
        isNull(workspaces.deletionTombstone),
        notExists(openTaskLink),
        notExists(projectRepositoryLink)
      )
    )
    .orderBy(workspaces.path)
    .all();
}

/** Re-evaluates the candidates at run time and untracks them in one transaction. */
export function untrackCleanableMissingWorktrees(db: AppDb, now = new Date()): number {
  const registry = createWorkspaceRegistry(db);
  const untracked = db.transaction((tx) => {
    const ids = findCleanableMissingWorktrees(tx).map((row) => row.workspaceId);
    if (ids.length === 0) return 0;
    return registry.untrack(ids, now.toISOString(), undefined, tx);
  });
  if (untracked > 0) appDbPokes.workspaces.poke({});
  return untracked;
}

export function getWorkspaceCleanupPreview(db: AppDb): WorkspaceCleanupPreview {
  return { missingWorktrees: findCleanableMissingWorktrees(db), database: getDatabaseSpace(db) };
}

/**
 * Runs the selected steps in order: untrack first so compaction also reclaims what the
 * untrack frees. A compaction failure still reports the untracked count.
 */
export function runWorkspaceCleanup(
  db: AppDb,
  input: { untrackMissing: boolean; compactDatabase: boolean }
): Result<
  { untracked: number; freedBytes: number },
  { type: 'compact-failed'; message: string; untracked: number }
> {
  const untracked = input.untrackMissing ? untrackCleanableMissingWorktrees(db) : 0;
  if (!input.compactDatabase) return ok({ untracked, freedBytes: 0 });
  try {
    return ok({ untracked, freedBytes: compactDatabase(db) });
  } catch (error) {
    return err({
      type: 'compact-failed',
      message: error instanceof Error ? error.message : String(error),
      untracked,
    });
  }
}
