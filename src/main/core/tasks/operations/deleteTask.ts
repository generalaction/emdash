import { eq } from 'drizzle-orm';
import { projectManager } from '@main/core/projects/project-manager';
import { taskManager } from '@main/core/tasks/task-manager';
import { viewStateService } from '@main/core/view-state/view-state-service';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import type { DeleteTaskOptions } from '@shared/tasks';
import { deleteWorkspaceIfUnused, removeWorktreeIfUnused } from './task-lifecycle-utils';

export async function deleteTask(
  projectId: string,
  taskId: string,
  options: DeleteTaskOptions = {}
): Promise<void> {
  const { deleteWorktree = true, deleteBranch = false } = options;

  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) return;
  const sourceBranch = task.sourceBranch ?? undefined;

  const project = projectManager.getProject(projectId);

  if (project) {
    const teardownResult = await taskManager.teardownTask(taskId, 'terminate').catch((e) => {
      log.warn('deleteTask: teardown failed', { taskId, error: String(e) });
      return null;
    });

    if (teardownResult && !teardownResult.success) {
      log.warn('deleteTask: teardown failed', { taskId, error: teardownResult.error.message });
    }
  }

  if (task.workspaceId) {
    await deleteWorkspaceIfUnused(task.workspaceId, taskId);
  }

  await db.delete(tasks).where(eq(tasks.id, taskId));
  void viewStateService.del(`task:${taskId}`);
  telemetryService.capture('task_deleted', { project_id: projectId, task_id: taskId });

  if (project && deleteWorktree) {
    const worktreeRemoved = await removeWorktreeIfUnused(task, project, false);
    if (
      worktreeRemoved &&
      deleteBranch &&
      sourceBranch &&
      task.taskBranch !== sourceBranch.branch
    ) {
      const branchDelete = await project.repository.deleteBranch(task.taskBranch!).catch((e) => {
        log.warn('deleteTask: branch deletion failed', { taskId, error: String(e) });
        return null;
      });
      if (branchDelete && !branchDelete.success) {
        log.warn('deleteTask: branch deletion failed', { taskId, error: branchDelete.error });
      }
    }
  }
}
