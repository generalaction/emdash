import { projectManager } from '@main/core/projects/project-manager';
import { log } from '@main/lib/logger';
import { err, ok, type Result } from '@shared/lib/result';
import type { OpenProjectError } from '@shared/projects';
import { checkIsValidDirectory } from '../path-utils';
import { ensureRepositoryWorkspace } from './ensure-repository-workspace';
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

  // Ensure the project has a shared repository-root workspace row.
  // This is idempotent and handles both new projects and pre-migration rows.
  try {
    await ensureRepositoryWorkspace(project);
  } catch (error) {
    log.warn('openProject: ensureRepositoryWorkspace failed (non-fatal)', {
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return ok();
}
