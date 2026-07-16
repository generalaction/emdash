import type { OperationsService } from '@main/core/operations/operations-service';
import type { DeleteTaskOptions } from '@shared/core/tasks/tasks';

export async function deleteTask(
  projectId: string,
  taskId: string,
  options: DeleteTaskOptions = {}
): Promise<void> {
  void projectId;
  const operationsService = await getOperationsService();
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

async function getOperationsService(): Promise<OperationsService> {
  return (await import('@main/core/operations/operations-service')).operationsService;
}
