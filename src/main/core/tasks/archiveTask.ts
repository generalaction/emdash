import { and, eq, isNull, sql } from 'drizzle-orm';
import { projectManager } from '@main/core/projects/project-manager';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { capture } from '@main/lib/telemetry';

export async function archiveTask(projectId: string, taskId: string): Promise<void> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) return;

  const project = projectManager.getProject(projectId);

  await db
    .update(tasks)
    .set({
      status: 'archived',
      archivedAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
      statusChangedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(tasks.id, taskId));
  capture('task_archived', { project_id: projectId, task_id: taskId });

  if (!project) return;

  void project.tasks
    .teardownTask(taskId, 'terminate')
    .then((teardownResult) => {
      if (!teardownResult.success) {
        log.warn('archiveTask: teardown failed', { taskId, error: teardownResult.error.message });
      }
    })
    .catch((e) => {
      log.warn('archiveTask: teardown failed', { taskId, error: String(e) });
    });

  if (task.taskBranch) {
    const siblings = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.projectId, task.projectId),
          eq(tasks.taskBranch, task.taskBranch),
          isNull(tasks.archivedAt)
        )
      )
      .limit(1);

    if (siblings.length === 0) {
      await project.removeTaskWorktree(task.taskBranch).catch((e) => {
        log.warn('archiveTask: worktree removal failed', { taskId, error: String(e) });
      });
    }
  }
}
