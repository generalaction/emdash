import { getTaskStore } from '@core/features/tasks/browser/stores/task-selectors';
import { workspaceRegistry } from '@core/features/workspaces/browser/stores/workspace-registry';
import { taskCompositionStoreToken } from './contributions/task-store-tokens';

export function getTaskComposition(projectId: string, taskId: string) {
  return getTaskStore(projectId, taskId)?.get(taskCompositionStoreToken);
}

export function getTaskWorkspace(projectId: string, taskId: string) {
  const workspaceId = getTaskStore(projectId, taskId)?.workspaceId;
  return workspaceId ? workspaceRegistry.get(workspaceId) : undefined;
}
