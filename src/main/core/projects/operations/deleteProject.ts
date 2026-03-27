import { eq } from 'drizzle-orm';
import { projectManager } from '@main/core/projects/project-manager';
import { getTasks } from '@main/core/tasks/getTasks';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';

export async function deleteProject(id: string): Promise<void> {
  const provider = projectManager.getProject(id);
  if (provider) {
    const projectTasks = await getTasks(id);
    await Promise.allSettled(projectTasks.map((t) => provider.teardownTask(t.id)));
  }
  await db.delete(projects).where(eq(projects.id, id));
  await projectManager.closeProject(id);
}
