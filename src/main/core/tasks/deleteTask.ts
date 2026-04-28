import { and, eq } from 'drizzle-orm';
import { projectManager } from '@main/core/projects/project-manager';
import { viewStateService } from '@main/core/view-state/view-state-service';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { capture } from '@main/lib/telemetry';

export async function deleteTask(projectId: string, taskId: string): Promise<void> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) return;
  const sourceBranch = task.sourceBranch ?? undefined;

  const project = projectManager.getProject(projectId);

  if (project) {
    const teardownResult = await project.tasks.teardownTask(taskId).catch((e) => {
      log.warn('deleteTask: teardown failed', { taskId, error: String(e) });
      return null;
    });

    if (teardownResult && !teardownResult.success) {
      log.warn('deleteTask: teardown failed', { taskId, error: teardownResult.error.message });
    }
  }

  await db.delete(tasks).where(eq(tasks.id, taskId));
  void viewStateService.del(`task:${taskId}`);
  capture('task_deleted', { project_id: projectId, task_id: taskId });

  if (project) {
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
        if (sourceBranch && task.taskBranch !== sourceBranch.branch) {
          const branchDelete = await project.repository.deleteBranch(task.taskBranch).catch((e) => {
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
