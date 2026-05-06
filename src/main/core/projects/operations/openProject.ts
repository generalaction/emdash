import type { OpenProjectError } from '@shared/projects';
import { err, ok, type Result } from '@shared/result';
import { projectManager } from '@main/core/projects/project-manager';
import { checkIsValidDirectory } from '../path-utils';
import { getProjectById } from './getProjects';

export async function openProject(projectId: string): Promise<Result<void, OpenProjectError>> {
  const project = await getProjectById(projectId);
  if (!project) return err({ type: 'error', message: `Project not found: ${projectId}` });
  if (project.type === 'local' && !checkIsValidDirectory(project.path)) {
    return err({ type: 'path-not-found', path: project.path });
  }
  const result = await projectManager.openProject(project);
  if (!result.success) {
    if (project.type === 'ssh') {
      return err({ type: 'ssh-disconnected', connectionId: project.connectionId });
    }
    return err({ type: 'error', message: result.error.message });
  }
  return ok();
}
