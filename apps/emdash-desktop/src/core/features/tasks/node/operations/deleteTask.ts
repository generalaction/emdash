import type { DeleteTaskOptions } from '@core/primitives/tasks/api';
import type { OperationsEngine } from '@core/services/operations/node';
import { enqueueDeleteTask } from './delete-task-definition';

export async function deleteTask(
  operations: OperationsEngine,
  projectId: string,
  taskId: string,
  options: DeleteTaskOptions = {}
): Promise<void> {
  void projectId;
  const result = await enqueueDeleteTask(operations, {
    taskId,
    deleteWorktree: options.deleteWorktree,
    deleteBranch: options.deleteBranch,
  });
  if (!result.success && result.error.type !== 'task-not-found') {
    throw new Error(result.error.message);
  }
}
