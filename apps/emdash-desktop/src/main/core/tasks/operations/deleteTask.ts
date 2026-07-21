import type { DeleteTaskOptions } from '@core/primitives/tasks/api';
import { enqueueDeleteTask } from './delete-task-definition';

export async function deleteTask(
  projectId: string,
  taskId: string,
  options: DeleteTaskOptions = {}
): Promise<void> {
  void projectId;
  const result = await enqueueDeleteTask({
    taskId,
    deleteWorktree: options.deleteWorktree,
    deleteBranch: options.deleteBranch,
  });
  if (!result.success && result.error.type !== 'task-not-found') {
    throw new Error(result.error.message);
  }
}
