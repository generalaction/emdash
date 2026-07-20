import { and, eq, isNull, ne } from 'drizzle-orm';
import type { DeletePreflightResult, TaskDeletePreflightItem } from '@core/primitives/tasks/api';
import { tasks, workspaces } from '@core/services/app-db/node/schema';
import { checkoutSelector } from '@main/core/git/runtime-client';
import { projectManager } from '@main/core/projects/project-manager';
import { getProvisionedWorkspaceBranch } from '@main/core/workspaces/workspace-branch';
import { getAppDb } from '@main/db/instance';
import { log } from '@main/lib/logger';

async function getTaskPreflight(
  projectId: string,
  taskId: string
): Promise<TaskDeletePreflightItem> {
  const noWorktreeResult: TaskDeletePreflightItem = {
    taskId,
    hasWorktree: false,
    hasUncommittedChanges: false,
    hasDeletableBranch: false,
  };

  const [task] = await getAppDb()
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt)))
    .limit(1);
  if (!task?.workspaceId) return noWorktreeResult;

  const [ws] = await getAppDb()
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, task.workspaceId), isNull(workspaces.deletedAt)))
    .limit(1);
  if (!ws) return noWorktreeResult;

  const provisionedBranch = getProvisionedWorkspaceBranch(ws);
  if (!provisionedBranch) return noWorktreeResult;

  const siblings = await getAppDb()
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.workspaceId, ws.id), ne(tasks.id, taskId), isNull(tasks.deletedAt)))
    .limit(1);

  const hasWorktree = siblings.length === 0;

  // A branch is deletable when it was created from a source branch (create-branch intent).
  const fromBranch = ws.config?.git.kind === 'create-branch' ? ws.config.git.fromBranch : undefined;
  const hasDeletableBranch = hasWorktree && !!fromBranch && provisionedBranch !== fromBranch.branch;

  let hasUncommittedChanges = false;
  if (hasWorktree) {
    const project = projectManager.getProject(projectId);
    if (project) {
      try {
        const worktreePath = await project.findTaskWorktree(provisionedBranch);
        if (worktreePath) {
          const status = (
            await project.git.checkout.model
              .state(checkoutSelector(worktreePath), 'status')
              .snapshot()
          ).data;
          if (status.kind === 'error') {
            log.warn('getDeletePreflight: git status check failed', {
              taskId,
              error: status.message,
            });
          }
          if (status.kind === 'ok') {
            hasUncommittedChanges =
              status.summary.staged > 0 ||
              status.summary.unstaged > 0 ||
              status.summary.untracked > 0;
          }
          if (status.kind === 'too-many-files') hasUncommittedChanges = true;
        }
      } catch (e) {
        log.warn('getDeletePreflight: git status check failed', { taskId, error: String(e) });
      }
    }
  }

  return { taskId, hasWorktree, hasUncommittedChanges, hasDeletableBranch };
}

export async function getDeletePreflight(
  projectId: string,
  taskIds: string[]
): Promise<DeletePreflightResult> {
  const items = await Promise.all(taskIds.map((id) => getTaskPreflight(projectId, id)));
  return { tasks: items };
}
