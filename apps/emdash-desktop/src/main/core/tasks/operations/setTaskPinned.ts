import { and, eq, isNull, sql } from 'drizzle-orm';
import { tasks } from '@core/services/app-db/node/schema';
import { getAppDb } from '@main/db/instance';

export async function setTaskPinned(taskId: string, isPinned: boolean): Promise<void> {
  const [row] = await getAppDb()
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt)))
    .limit(1);
  if (!row) throw new Error(`Task not found: ${taskId}`);

  await getAppDb()
    .update(tasks)
    .set({
      isPinned: isPinned ? 1 : 0,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt)));
}
