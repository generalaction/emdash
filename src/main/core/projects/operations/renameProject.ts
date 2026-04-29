import { eq, sql } from 'drizzle-orm';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';

export async function renameProject(projectId: string, newName: string): Promise<void> {
  const trimmed = newName.trim();
  if (!trimmed) throw new Error('Project name cannot be empty');

  const [row] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!row) throw new Error(`Project not found: ${projectId}`);

  await db
    .update(projects)
    .set({ name: trimmed, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(projects.id, projectId));
}
