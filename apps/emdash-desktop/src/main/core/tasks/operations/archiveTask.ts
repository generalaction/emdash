import { eq, sql } from 'drizzle-orm';
import { taskSessionManager } from '@main/core/tasks/task-session-manager';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';

export async function archiveTask(projectId: string, taskId: string): Promise<void> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) return;

  await db
    .update(tasks)
    .set({
      archivedAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(tasks.id, taskId));
  telemetryService.capture('task_archived', { project_id: projectId, task_id: taskId });

  // 'archive' reaps the tmux session + agent process but keeps the worktree and the
  // persisted session id, so Restore can resume. Plain 'detach' would leak the tmux
  // session indefinitely (#2689).
  const teardownResult = await taskSessionManager.teardownTask(taskId, 'archive').catch((e) => {
    log.warn('archiveTask: teardown failed', { taskId, error: String(e) });
    return null;
  });

  if (teardownResult && !teardownResult.success) {
    log.warn('archiveTask: teardown failed', { taskId, error: teardownResult.error.message });
  }

  if (!teardownResult || !teardownResult.success) {
    await taskSessionManager.forceRemoveTask(
      taskId,
      'archiveTask continued after teardown failure'
    );
  }
}
