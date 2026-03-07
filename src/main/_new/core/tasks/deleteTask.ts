import { db } from '../../db/client';
import { tasks } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { environmentProviderManager } from '../../environment/provider-manager';

export async function deleteTask(id: string): Promise<void> {
  // Tear down all PTY sessions for this task across all providers.
  await environmentProviderManager.teardownTask(id);
  await db.delete(tasks).where(eq(tasks.id, id));
}
