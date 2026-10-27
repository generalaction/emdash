import { getGitCheckoutStore } from '@core/features/source-control/api/browser/stores/source-control-selectors';
import { getTaskStore } from '@core/features/tasks/api/browser/task-state/task-selectors';
import { taskCompositionHandleStoreToken } from '@core/features/workbench/contributions/browser/task-store-tokens';
import { workspaceRegistry } from '@core/features/workspaces/api/browser/stores/workspace-registry';

export function getTaskComposition(projectId: string, taskId: string) {
  return getTaskStore(projectId, taskId)?.get(taskCompositionHandleStoreToken).current ?? undefined;
}

export function getTaskWorkspace(projectId: string, taskId: string) {
  const workspaceId = getTaskStore(projectId, taskId)?.workspaceId;
  return workspaceId ? workspaceRegistry.get(workspaceId) : undefined;
}

/** Tasks are shown by their workspace's live branch; the stored name is the fallback.
 * Call only inside `observer` components (or other MobX reactions). */
export function getTaskDisplayName(projectId: string, taskId: string): string | undefined {
  const task = getTaskStore(projectId, taskId);
  if (!task) return undefined;
  const branch = task.workspaceId ? getGitCheckoutStore(task.workspaceId)?.branchName : null;
  return branch || task.data.name;
}
