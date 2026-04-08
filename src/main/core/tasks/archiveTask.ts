import { eq, sql } from 'drizzle-orm';
import { projectManager } from '@main/core/projects/project-manager';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { log } from '@main/lib/logger';

export async function archiveTask(projectId: string, taskId: string): Promise<void> {
  const project = projectManager.getProject(projectId);
  const taskBranch = project?.getTask(taskId)?.taskBranch;

  await db
    .update(tasks)
    .set({
      status: 'archived',
      archivedAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
      statusChangedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(tasks.id, taskId));

  await project?.teardownTask(taskId);

  if (taskBranch) {
    await project?.removeTaskWorktree(taskBranch).catch((e) => {
      log.warn('archiveTask: worktree removal failed', { taskId, error: String(e) });
    });
  }
}
