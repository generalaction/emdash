import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';

export async function renameProject({
  projectId,
  name,
}: {
  projectId: string;
  name: string;
  renameProjectDirectory?: boolean;
}): Promise<void> {
  await db.update(projects).set({ name }).where(eq(projects.id, projectId));
}
