import { getGitCheckoutStore } from '@core/features/source-control/api/browser/stores/source-control-selectors';
import { getTaskStore } from '@core/features/tasks/api/browser/task-state/task-selectors';
import type { GitCheckoutStore } from '../../../browser/stores/git-checkout-store';

/** Call only inside `observer` components (or other MobX reactions). */
export function getTaskGitCheckoutStore(
  projectId: string,
  taskId: string
): GitCheckoutStore | undefined {
  const workspaceId = getTaskStore(projectId, taskId)?.workspaceId;
  return workspaceId ? getGitCheckoutStore(workspaceId) : undefined;
}
