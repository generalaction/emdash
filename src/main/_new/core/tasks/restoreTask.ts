import { db } from '../../db/client';
import { tasks } from '../../db/schema';
import { eq, sql } from 'drizzle-orm';
import type { TaskMetadata } from './core';

export async function restoreTask(id: string): Promise<void> {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!row) return;

  const meta: TaskMetadata = row.metadata ? JSON.parse(row.metadata) : {};
  meta.lifecycleStatus = 'in_progress';

  await db
    .update(tasks)
    .set({
      archivedAt: null,
      status: 'in_progress',
      metadata: JSON.stringify(meta),
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(tasks.id, id));
}
