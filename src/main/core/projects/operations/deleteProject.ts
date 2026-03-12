import { eq } from 'drizzle-orm';
import { projectManager } from '@main/core/projects/project-manager';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';

export async function deleteProject(id: string): Promise<void> {
  await projectManager.removeProject(id);
  await db.delete(projects).where(eq(projects.id, id));
}
