import { and, eq, isNull, sql } from 'drizzle-orm';
import { type TaskLifecycleStatus } from '@core/primitives/tasks/api';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { telemetryService } from '@main/lib/telemetry';

export async function updateTaskStatus(taskId: string, status: TaskLifecycleStatus): Promise<void> {
  const [row] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt)))
    .limit(1);
  if (!row) throw new Error(`Task not found: ${taskId}`);
  if (row.status === status) return;

  await db
    .update(tasks)
    .set({
      status,
      updatedAt: sql`CURRENT_TIMESTAMP`,
      statusChangedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt)));

  telemetryService.capture('task_status_changed', {
    from_status: row.status as TaskLifecycleStatus,
    to_status: status,
    project_id: row.projectId,
    task_id: row.id,
  });
}
