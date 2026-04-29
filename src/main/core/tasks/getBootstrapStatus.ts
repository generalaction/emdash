import type { TaskBootstrapStatus } from '@shared/tasks';
import { taskManager } from '@main/core/projects/task-manager';
import { log } from '@main/lib/logger';

export async function getBootstrapStatus(
  _projectId: string,
  taskId: string
): Promise<TaskBootstrapStatus> {
  const status = taskManager.getBootstrapStatus(taskId);
  log.debug('getBootstrapStatus', { taskId, status: status.status });
  return status;
}
