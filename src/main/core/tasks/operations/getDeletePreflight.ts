import { and, eq, ne } from 'drizzle-orm';
import { projectManager } from '@main/core/projects/project-manager';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { log } from '@main/lib/logger';
import type { DeletePreflightResult, TaskDeletePreflightItem } from '@shared/tasks';

async function getTaskPreflight(
  projectId: string,
  taskId: string
): Promise<TaskDeletePreflightItem> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task?.taskBranch) {
    return { taskId, hasWorktree: false, hasUncommittedChanges: false, hasDeletableBranch: false };
  }

  const siblings = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, projectId),
        eq(tasks.taskBranch, task.taskBranch),
        ne(tasks.id, taskId)
      )
    )
    .limit(1);

  const hasWorktree = siblings.length === 0;

  const sourceBranch = task.sourceBranch ?? undefined;
  const hasDeletableBranch =
    hasWorktree && !!sourceBranch && task.taskBranch !== sourceBranch.branch;

  let hasUncommittedChanges = false;
  if (hasWorktree) {
    const project = projectManager.getProject(projectId);
    if (project) {
      try {
        const worktreePath = await project.worktreeService.getWorktree(task.taskBranch);
        if (worktreePath) {
          const { stdout } = await project.ctx.exec('git', [
            '-C',
            worktreePath,
            'status',
            '--porcelain',
          ]);
          hasUncommittedChanges = stdout.trim().length > 0;
        }
      } catch (e) {
        log.warn('getDeletePreflight: git status check failed', { taskId, error: String(e) });
      }
    }
  }

  return { taskId, hasWorktree, hasUncommittedChanges, hasDeletableBranch };
}

export async function getDeletePreflight(
  projectId: string,
  taskIds: string[]
): Promise<DeletePreflightResult> {
  const items = await Promise.all(taskIds.map((id) => getTaskPreflight(projectId, id)));
  return { tasks: items };
}
