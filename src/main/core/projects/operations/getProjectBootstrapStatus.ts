import type { ProjectBootstrapStatus } from '@shared/projects';
import { projectManager } from '@main/core/projects/project-manager';
import { log } from '@main/lib/logger';

export async function getProjectBootstrapStatus(
  projectId: string
): Promise<ProjectBootstrapStatus> {
  const status = projectManager.getProjectBootstrapStatus(projectId);
  log.debug('getProjectBootstrapStatus', { projectId, status: status.status });
  return status;
}
