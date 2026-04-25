import { eq, sql } from 'drizzle-orm';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';

export async function restoreTask(id: string): Promise<void> {
  await db
    .update(tasks)
    .set({
      archivedAt: null,
      status: 'in_progress',
      updatedAt: sql`CURRENT_TIMESTAMP`,
      statusChangedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(tasks.id, id));
}
