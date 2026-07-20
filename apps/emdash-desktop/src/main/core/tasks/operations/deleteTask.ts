import type { DeleteTaskOptions } from '@core/primitives/tasks/api';
import { operationsService } from '@main/core/operations/operations-service';

export async function deleteTask(
  projectId: string,
  taskId: string,
  options: DeleteTaskOptions = {}
): Promise<void> {
  void projectId;
  await operationsService.initialize();
  const result = await operationsService.enqueueDeleteTask({
    taskId,
    deleteWorktree: options.deleteWorktree,
    deleteBranch: options.deleteBranch,
  });
  if (!result.success && result.error.type !== 'task-not-found') {
    throw new Error(result.error.message);
  }
}
