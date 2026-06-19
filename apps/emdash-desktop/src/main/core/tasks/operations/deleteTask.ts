import { eq } from 'drizzle-orm';
import { projectManager } from '@main/core/projects/project-manager';
import { taskSessionManager } from '@main/core/tasks/task-session-manager';
import { viewStateService } from '@main/core/view-state/view-state-service';
import { getProvisionedWorkspaceBranch } from '@main/core/workspaces/workspace-branch';
import { db } from '@main/db/client';
import { tasks, workspaces } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import type { DeleteTaskOptions } from '@shared/core/tasks/tasks';
import type { WorkspaceConfig } from '@shared/core/workspaces/workspace-config';
import { deleteWorkspaceIfUnused, removeWorktreeIfUnused } from './task-lifecycle-utils';

export async function deleteTask(
  projectId: string,
  taskId: string,
  options: DeleteTaskOptions = {}
): Promise<void> {
  const { deleteWorktree = true, deleteBranch = false } = options;

  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) return;

  const project = projectManager.getProject(projectId);

  if (project) {
    const teardownResult = await taskSessionManager.teardownTask(taskId, 'terminate').catch((e) => {
      log.warn('deleteTask: teardown failed', { taskId, error: String(e) });
      return null;
    });

    if (teardownResult && !teardownResult.success) {
      log.warn('deleteTask: teardown failed', { taskId, error: teardownResult.error.message });
    }
  }

  // Load workspace row before deleting it (we may need workspace metadata for cleanup).
  let wsRow:
    | {
        id: string;
        kind: 'worktree' | 'project-root' | 'byoi' | null;
        branchName: string | null;
        config: WorkspaceConfig | null;
      }
    | undefined;
  if (task.workspaceId) {
    const [ws] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, task.workspaceId))
      .limit(1);
    if (ws) wsRow = ws;
    await deleteWorkspaceIfUnused(task.workspaceId, taskId);
  }

  await db.delete(tasks).where(eq(tasks.id, taskId));
  void viewStateService.del(`task:${taskId}`);
  telemetryService.capture('task_deleted', { project_id: projectId, task_id: taskId });

  if (project && deleteWorktree && wsRow) {
    const worktreeRemoved = await removeWorktreeIfUnused(wsRow, project, false);
    const provisionedBranch = getProvisionedWorkspaceBranch(wsRow);
    if (worktreeRemoved && deleteBranch && provisionedBranch) {
      const fromBranch =
        wsRow.config?.git.kind === 'create-branch' ? wsRow.config.git.fromBranch : undefined;
      if (fromBranch && provisionedBranch !== fromBranch.branch) {
        const branchDelete = await project.gitRepository
          .deleteBranch(provisionedBranch)
          .catch((e) => {
            log.warn('deleteTask: branch deletion failed', { taskId, error: String(e) });
            return null;
          });
        if (branchDelete && !branchDelete.success) {
          log.warn('deleteTask: branch deletion failed', { taskId, error: branchDelete.error });
        }
      }
    }
  }
}
