import { eq, sql } from 'drizzle-orm';
import { projectManager } from '@main/core/projects/project-manager';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';

export async function archiveTask(projectId: string, taskId: string): Promise<void> {
  const project = projectManager.getProject(projectId);

  await db
    .update(tasks)
    .set({
      status: 'archived',
      archivedAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(tasks.id, taskId));

  await project?.teardownTask(taskId);
}
