import type { TaskBootstrapStatus } from '@shared/tasks';
import { projectManager } from '@main/core/projects/project-manager';
import { log } from '@main/lib/logger';

export async function getBootstrapStatus(
  projectId: string,
  taskId: string
): Promise<TaskBootstrapStatus> {
  const project = projectManager.getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  const status = project.getTaskBootstrapStatus(taskId);
  log.debug('getBootstrapStatus', { taskId, status: status.status });
  return status;
}
