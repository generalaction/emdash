import type { WorkspaceRemovalBroker } from '@core/features/workspaces/api/node/operations/workspace-removal';
import type { DeleteTaskOptions } from '@core/primitives/tasks/api';
import type { OperationsEngine } from '@core/services/operations/node';
import { enqueueDeleteTask } from './delete-task-definition';

export async function deleteTask(
  operations: OperationsEngine,
  runtimes: WorkspaceRemovalBroker,
  projectId: string,
  taskId: string,
  options: DeleteTaskOptions = {}
): Promise<void> {
  void projectId;
  const result = await enqueueDeleteTask(operations, runtimes, {
    taskId,
    deleteWorktree: options.deleteWorktree,
    deleteBranch: options.deleteBranch,
    deleteConversations: options.deleteConversations,
  });
  if (!result.success && result.error.type !== 'task-not-found') {
    throw new Error(result.error.message);
  }
}
