import { and, eq } from 'drizzle-orm';
import { projectManager } from '@main/core/projects/project-manager';
import { viewStateService } from '@main/core/view-state/view-state-service';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { log } from '@main/lib/logger';

export async function deleteTask(projectId: string, taskId: string): Promise<void> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) return;

  const project = projectManager.getProject(projectId);

  await db.delete(tasks).where(eq(tasks.id, taskId));
  void viewStateService.del(`task:${taskId}`);

  if (project) {
    const teardownResult = await project.teardownTask(taskId);
    if (!teardownResult.success) {
      log.warn('deleteTask: teardown failed', { taskId, error: teardownResult.error.message });
      return;
    }

    if (task.taskBranch) {
      const siblings = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.projectId, task.projectId), eq(tasks.taskBranch, task.taskBranch)))
        .limit(1);

      if (siblings.length === 0) {
        await project.removeTaskWorktree(task.taskBranch).catch((e) => {
          log.warn('deleteTask: worktree removal failed', { taskId, error: String(e) });
        });
        if (task.taskBranch !== task.sourceBranch) {
          const branchDelete = await project.git.deleteBranch(task.taskBranch).catch((e) => {
            log.warn('deleteTask: branch deletion failed', { taskId, error: String(e) });
            return null;
          });
          if (branchDelete && !branchDelete.success) {
            log.warn('deleteTask: branch deletion failed', { taskId, error: branchDelete.error });
          }
        }
      }
    }
  }
}
