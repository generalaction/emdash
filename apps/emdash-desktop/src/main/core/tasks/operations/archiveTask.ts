import { eq, sql } from 'drizzle-orm';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { teardownTaskResources } from './teardownTaskResources';

export async function archiveTask(projectId: string, taskId: string): Promise<void> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) return;

  const teardownResult = await teardownTaskResources(task, 'archive');
  if (!teardownResult.success) {
    log.warn('archiveTask: teardown failed', { taskId, error: teardownResult.error.message });
    throw new Error(`Failed to archive task resources: ${teardownResult.error.message}`);
  }

  await db
    .update(tasks)
    .set({
      archivedAt: sql`CURRENT_TIMESTAMP`,
      lifecycleTeardownAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(tasks.id, taskId));
  telemetryService.capture('task_archived', { project_id: projectId, task_id: taskId });
}
