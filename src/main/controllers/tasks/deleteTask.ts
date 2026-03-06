import { db } from '@/db/client';
import { tasks } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { cleanupTaskPtys } from '@/services/ptyCleanup';

export async function deleteTask(id: string): Promise<void> {
  await cleanupTaskPtys(id);
  await db.delete(tasks).where(eq(tasks.id, id));
}
