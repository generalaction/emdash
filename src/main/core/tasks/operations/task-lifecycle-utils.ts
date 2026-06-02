import { and, eq, isNull, ne } from 'drizzle-orm';
import { workspaceFileIndexService } from '@main/core/search/workspace-file-index-service';
import { db } from '@main/db/client';
import { tasks, workspaces } from '@main/db/schema';
import { log } from '@main/lib/logger';
import type { ProjectProvider } from '../../projects/project-provider';

/**
 * Removes the worktree when no remaining sibling tasks share the same workspace.
 *
 * `excludeArchived = true`  — only non-archived siblings block removal (use for archiveTask).
 * `excludeArchived = false` — any remaining sibling blocks removal (use for deleteTask).
 *
 * Returns `true` if the worktree was removed (no siblings found), `false` otherwise.
 */
export async function removeWorktreeIfUnused(
  workspace: { id: string; branchName: string | null },
  project: ProjectProvider,
  excludeArchived: boolean
): Promise<boolean> {
  if (!workspace.branchName) return false;

  const where = excludeArchived
    ? and(eq(tasks.workspaceId, workspace.id), isNull(tasks.archivedAt))
    : eq(tasks.workspaceId, workspace.id);

  const siblings = await db.select({ id: tasks.id }).from(tasks).where(where).limit(1);
  if (siblings.length > 0) return false;

  await project.removeTaskWorktree(workspace.branchName).catch((e) => {
    log.warn('removeWorktreeIfUnused: worktree removal failed', {
      branchName: workspace.branchName,
      error: String(e),
    });
  });
  return true;
}

/**
 * Deletes the workspace row only when no other task still references it.
 *
 * Tasks are deduplicated onto a single workspace row per resolved path (see
 * `WorkspaceBootstrapService.persistPath`), so for `no-worktree` tasks every task in a
 * project shares the project-root workspace. Deleting it unconditionally orphaned the
 * siblings, whose `workspaceId` then pointed at a missing row — surfacing later as
 * `Workspace not found` during bootstrap. `excludeTaskId` is the task being deleted; its
 * row still exists at this point, so it must not count as a reference.
 */
export async function deleteWorkspaceIfUnused(
  workspaceId: string,
  excludeTaskId: string
): Promise<void> {
  const [sibling] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.workspaceId, workspaceId), ne(tasks.id, excludeTaskId)))
    .limit(1);
  if (sibling) return;

  await db
    .delete(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .catch((e) => {
      log.warn('deleteWorkspaceIfUnused: workspace row deletion failed', {
        workspaceId,
        error: String(e),
      });
    });
}

/**
 * Deletes the workspace file index when no non-archived sibling task shares the workspace.
 */
export async function deleteIndexIfUnused(workspaceId: string): Promise<void> {
  const siblings = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.workspaceId, workspaceId), isNull(tasks.archivedAt)))
    .limit(1);

  if (siblings.length === 0) {
    workspaceFileIndexService.deleteIndex(workspaceId);
  }
}
