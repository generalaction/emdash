import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { projects, tasks } from '../../db/schema';
import { log } from '../../lib/logger';
import { environmentProviderManager } from '../../workspaces/provider-manager';
import { worktreeService } from '../worktrees/WorktreeService';

export async function deleteTask(id: string): Promise<void> {
  // Read task before deleting so we can clean up its worktree.
  const [task] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);

  // Tear down all PTY sessions for this task across all providers.
  await environmentProviderManager.teardownTask(id);

  // Remove the git worktree if one was created for this task.
  if (task?.useWorktree && task.path && task.projectId) {
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, task.projectId))
      .limit(1);
    if (project) {
      await worktreeService
        .removeWorktree(project.path, id, task.path, task.branch ?? undefined)
        .catch((e) => {
          log.warn('deleteTask: worktree removal failed', { taskId: id, error: String(e) });
        });
    }
  }

  await db.delete(tasks).where(eq(tasks.id, id));
}
