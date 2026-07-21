import { isRuntimeResolveError } from '@emdash/core/services/runtime-broker/api';
import { err, ok, type Result } from '@emdash/shared';
import { log } from '@emdash/shared/logger';
import type { ProjectSessionManager } from '@core/features/projects/api/node/project-manager';
import type { OpenProjectError, OpenProjectSuccess } from '@core/primitives/projects/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { checkIsValidDirectory } from '../path-utils';
import { ensureRepositoryWorkspace } from './ensure-repository-workspace';
import { getProjectById } from './getProjects';

export async function openProject(
  db: AppDb,
  projects: Pick<ProjectSessionManager, 'openProject'>,
  projectId: string
): Promise<Result<OpenProjectSuccess, OpenProjectError>> {
  const project = await getProjectById(db, projectId);
  if (!project) return err({ type: 'error', message: `Project not found: ${projectId}` });
  if (project.type === 'local' && !checkIsValidDirectory(project.path)) {
    return err({ type: 'path-not-found', path: project.path });
  }
  const result = await projects.openProject(project);
  if (!result.success) {
    return isRuntimeResolveError(result.error)
      ? err(result.error)
      : err({ type: 'error', message: result.error.message });
  }

  // Ensure the project has a shared repository-root workspace row.
  // This is idempotent and handles both new projects and pre-migration rows.
  let repositoryWorkspaceId: string | null = null;
  try {
    repositoryWorkspaceId = ensureRepositoryWorkspace(db, project);
  } catch (error) {
    log.warn('openProject: ensureRepositoryWorkspace failed (non-fatal)', {
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return ok({ repositoryWorkspaceId });
}
