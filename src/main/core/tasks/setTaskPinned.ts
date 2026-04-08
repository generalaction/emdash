import { eq, sql } from 'drizzle-orm';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';

export async function setTaskPinned(taskId: string, isPinned: boolean): Promise<void> {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!row) throw new Error(`Task not found: ${taskId}`);

  await db
    .update(tasks)
    .set({
      isPinned: isPinned ? 1 : 0,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(tasks.id, taskId));
}
