import { eq, sql } from 'drizzle-orm';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';

/** Persists both completed phases for terminate flows that intentionally retain the task row. */
export async function persistTaskResourceTeardown(taskId: string): Promise<void> {
  await db
    .update(tasks)
    .set({
      lifecycleTeardownAt: sql`CURRENT_TIMESTAMP`,
      providerDestroyAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(tasks.id, taskId));
}
