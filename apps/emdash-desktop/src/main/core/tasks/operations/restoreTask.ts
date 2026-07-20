import { eq, sql } from 'drizzle-orm';
import type { Task } from '@core/primitives/tasks/api';
import { tasks } from '@core/services/app-db/node/schema';
import { mapTaskRowToTask } from '@main/core/tasks/utils/utils';
import { getAppDb } from '@main/db/instance';

export async function restoreTask(id: string): Promise<Task | undefined> {
  const [updatedRow] = await getAppDb()
    .update(tasks)
    .set({
      archivedAt: null,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(tasks.id, id))
    .returning();

  return updatedRow ? mapTaskRowToTask(updatedRow) : undefined;
}
