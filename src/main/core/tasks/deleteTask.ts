import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { projects, tasks } from '../../db/schema';
import { log } from '../../lib/logger';

export async function deleteTask(id: string): Promise<void> {
  // Read task before deleting so we can clean up its worktree.
  const [task] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);

  await db.delete(tasks).where(eq(tasks.id, id));
}
