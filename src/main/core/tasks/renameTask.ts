import { eq, sql } from 'drizzle-orm';
import { projectManager } from '@main/core/projects/project-manager';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { appSettingsService } from '../settings/settings-service';
import { provisionTask } from './provisionTask';

export async function renameTask(
  projectId: string,
  taskId: string,
  newName: string
): Promise<void> {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!row) throw new Error(`Task not found: ${taskId}`);

  const project = projectManager.getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  const oldBranch = row.taskBranch;
  let newBranch: string | null = null;

  if (oldBranch) {
    const teardownResult = await project.teadownTask(taskId);
    if (!teardownResult.success) {
      log.warn('renameTask: teardown failed', { taskId, error: teardownResult.error.message });
    }

    const suffix = Math.random().toString(36).slice(2, 7);
    const branchPrefix = (await appSettingsService.get('localProject')).branchPrefix ?? '';
    newBranch = branchPrefix ? `${branchPrefix}/${newName}-${suffix}` : `${newName}-${suffix}`;

    await project.git.renameBranch(oldBranch, newBranch);
    await project.moveTaskWorktree(oldBranch, newBranch);
  }

  await db
    .update(tasks)
    .set({
      name: newName,
      taskBranch: newBranch ?? row.taskBranch,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(tasks.id, taskId));

  if (oldBranch) {
    await provisionTask(taskId);
  }
}
