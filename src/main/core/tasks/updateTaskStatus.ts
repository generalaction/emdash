import { eq, sql } from 'drizzle-orm';
import { TaskLifecycleStatus } from '@shared/tasks';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';

export async function updateTaskStatus(taskId: string, status: TaskLifecycleStatus): Promise<void> {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!row) throw new Error(`Task not found: ${taskId}`);

  await db
    .update(tasks)
    .set({
      status,
      updatedAt: sql`CURRENT_TIMESTAMP`,
      statusChangedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(tasks.id, taskId));
}
