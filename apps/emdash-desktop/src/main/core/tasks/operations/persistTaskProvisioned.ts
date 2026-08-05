import { eq, sql } from 'drizzle-orm';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';

export async function persistTaskProvisioned(taskId: string, workspaceId: string): Promise<void> {
  await db
    .update(tasks)
    .set({
      lastInteractedAt: sql`CURRENT_TIMESTAMP`,
      workspaceId,
    })
    .where(eq(tasks.id, taskId));
}
