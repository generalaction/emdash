import path from 'node:path';
import { eq } from 'drizzle-orm';
import { projectManager } from '@main/core/workspaces/project-manager';
import { db } from '../../db/client';
import { projects, tasks } from '../../db/schema';
import { log } from '../../lib/logger';
import { createLocalWorktreeService } from '../worktrees/_WorktreeService';

export async function deleteTask(id: string): Promise<void> {
  // Read task before deleting so we can clean up its worktree.
  const [task] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);

  // Tear down all PTY sessions for this task across all providers.
  await projectManager.teardownTask(id);

  // Remove the git worktree if one was created for this task.
  if (task?.repositoryPath && task.projectId) {
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, task.projectId))
      .limit(1);
    if (project) {
      const worktreesDir = path.join(project.path, '..', 'worktrees');
      const svc = createLocalWorktreeService(project.path, worktreesDir);
      await svc.removeWorktree(task.repositoryPath, task.branch ?? undefined).catch((e) => {
        log.warn('deleteTask: worktree removal failed', { taskId: id, error: String(e) });
      });
    }
  }

  await db.delete(tasks).where(eq(tasks.id, id));
}
