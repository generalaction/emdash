import { and, eq, isNull } from 'drizzle-orm';
import { workspaceFileIndexService } from '@main/core/search/workspace-file-index-service';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { log } from '@main/lib/logger';
import type { ProjectProvider } from '../../projects/project-provider';

/**
 * Removes the worktree when no remaining sibling tasks share the same branch.
 *
 * `excludeArchived = true`  — only non-archived siblings block removal (use for archiveTask).
 * `excludeArchived = false` — any remaining sibling blocks removal (use for deleteTask).
 *
 * Returns `true` if the worktree was removed (no siblings found), `false` otherwise.
 */
export async function removeWorktreeIfUnused(
  task: { taskBranch: string | null; projectId: string },
  project: ProjectProvider,
  excludeArchived: boolean
): Promise<boolean> {
  if (!task.taskBranch) return false;

  const where = excludeArchived
    ? and(
        eq(tasks.projectId, task.projectId),
        eq(tasks.taskBranch, task.taskBranch),
        isNull(tasks.archivedAt)
      )
    : and(eq(tasks.projectId, task.projectId), eq(tasks.taskBranch, task.taskBranch));

  const siblings = await db.select({ id: tasks.id }).from(tasks).where(where).limit(1);
  if (siblings.length > 0) return false;

  await project.removeTaskWorktree(task.taskBranch).catch((e) => {
    log.warn('removeWorktreeIfUnused: worktree removal failed', {
      taskBranch: task.taskBranch,
      error: String(e),
    });
  });
  return true;
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
