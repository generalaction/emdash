import { db } from '../../db/client';
import { tasks } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { taskResourceManager } from '../../environment/task-resource-manager';

export async function deleteTask(id: string): Promise<void> {
  await taskResourceManager.teardown(id);
  await db.delete(tasks).where(eq(tasks.id, id));
}
