import { getTaskStore } from '@core/features/tasks/browser/stores/task-selectors';
import type { GitCheckoutStore } from './git-checkout-store';
import { getGitCheckoutStore } from './source-control-selectors';

/** Call only inside `observer` components (or other MobX reactions). */
export function getTaskGitCheckoutStore(
  projectId: string,
  taskId: string
): GitCheckoutStore | undefined {
  const workspaceId = getTaskStore(projectId, taskId)?.workspaceId;
  return workspaceId ? getGitCheckoutStore(workspaceId) : undefined;
}
