import { eq } from 'drizzle-orm';
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
    project.teardownTask(taskId).catch((e) => {
      log.warn('deleteTask: teardown failed', { taskId, error: String(e) });
    });

    if (task.taskBranch) {
      project.removeTaskWorktree(task.taskBranch).catch((e) => {
        log.warn('deleteTask: worktree removal failed', { taskId, error: String(e) });
      });
      if (task.taskBranch !== task.sourceBranch) {
        project.git
          .deleteBranch(task.taskBranch)
          .then((result) => {
            if (!result.success) {
              log.warn('deleteTask: branch deletion failed', { taskId, error: result.error });
            }
          })
          .catch((e) => {
            log.warn('deleteTask: branch deletion failed', { taskId, error: String(e) });
          });
      }
    }
  }
}
