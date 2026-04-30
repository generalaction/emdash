import { and, eq, sql } from 'drizzle-orm';
import { projectManager } from '@main/core/projects/project-manager';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { appSettingsService } from '../../settings/settings-service';

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
  const sourceBranch = row.sourceBranch ?? undefined;
  let newBranch: string | null = null;

  if (oldBranch) {
    if (sourceBranch && oldBranch !== sourceBranch.branch) {
      const siblings = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.projectId, row.projectId), eq(tasks.taskBranch, oldBranch)))
        .limit(2);

      if (siblings.length === 1) {
        const suffix = Math.random().toString(36).slice(2, 7);
        const branchPrefix = (await appSettingsService.get('localProject')).branchPrefix ?? '';
        newBranch = branchPrefix ? `${branchPrefix}/${newName}-${suffix}` : `${newName}-${suffix}`;

        await project.repository.renameBranch(oldBranch, newBranch);
      }
    }
  }

  await db
    .update(tasks)
    .set({
      name: newName,
      taskBranch: newBranch ?? row.taskBranch,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(tasks.id, taskId));
}
