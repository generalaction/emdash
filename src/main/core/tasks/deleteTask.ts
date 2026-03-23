import { eq } from 'drizzle-orm';
import { projectManager } from '@main/core/projects/project-manager';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { log } from '@main/lib/logger';

export async function deleteTask(projectId: string, taskId: string): Promise<void> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) return;

  const project = projectManager.getProject(projectId);

  if (project) {
    const teardownResult = await project.teadownTask(taskId);
    if (!teardownResult.success) {
      log.warn('deleteTask: teardown failed', { taskId, error: teardownResult.error.message });
    }

    if (task.taskBranch) {
      await project.removeTaskWorktree(task.taskBranch).catch((e) => {
        log.warn('deleteTask: worktree removal failed', { taskId, error: String(e) });
      });

      await project.git.deleteBranch(task.taskBranch).catch((e) => {
        log.warn('deleteTask: branch deletion failed', { taskId, error: String(e) });
      });
    }
  }

  await db.delete(tasks).where(eq(tasks.id, taskId));
}
