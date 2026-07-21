import { eq, sql } from 'drizzle-orm';
import { taskSessionManager } from '@main/core/tasks/task-session-manager';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { telemetryService } from '@main/lib/telemetry';

export async function archiveTask(projectId: string, taskId: string): Promise<void> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) return;

  // Reap the tmux session + agent process before persisting the archive. If cleanup
  // cannot prove success, keep the task live and unarchived so the operation can retry.
  const teardownResult = await taskSessionManager.teardownTask(taskId, 'archive');
  if (!teardownResult.success) {
    throw new Error(`Failed to teardown task before archiving: ${teardownResult.error.message}`);
  }

  await db
    .update(tasks)
    .set({
      archivedAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(tasks.id, taskId));
  telemetryService.capture('task_archived', { project_id: projectId, task_id: taskId });
}
