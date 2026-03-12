import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';

export async function renameProject(id: string, name: string): Promise<void> {
  await db.update(projects).set({ name }).where(eq(projects.id, id));
}
