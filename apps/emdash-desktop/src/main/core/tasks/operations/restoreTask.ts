import { eq, sql } from 'drizzle-orm';
import { mapTaskRowToTask } from '@main/core/tasks/utils/utils';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import type { Task } from '@shared/core/tasks/tasks';

export async function restoreTask(id: string): Promise<Task | undefined> {
  const [updatedRow] = await db
    .update(tasks)
    .set({
      archivedAt: null,
      status: 'in_progress',
      updatedAt: sql`CURRENT_TIMESTAMP`,
      statusChangedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(tasks.id, id))
    .returning();

  return updatedRow ? mapTaskRowToTask(updatedRow) : undefined;
}
