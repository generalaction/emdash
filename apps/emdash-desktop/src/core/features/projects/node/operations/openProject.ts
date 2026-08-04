import {
  isRuntimeResolveError,
  type RuntimeBroker,
} from '@emdash/core/services/runtime-broker/api';
import { err, ok, type Result } from '@emdash/shared';
import type { ProjectSessionManager } from '@core/features/projects/api/node/project-manager';
import { fileKeyForAbsolutePath, hostPathFromNative } from '@core/primitives/desktop-runtime/api';
import {
  projectHostRef,
  type OpenProjectError,
  type OpenProjectSuccess,
} from '@core/primitives/projects/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { fsErrorMessage } from '@core/services/runtime-broker/node/files';
import { getProjectById } from './getProjects';

export async function openProject(
  db: AppDb,
  projects: Pick<ProjectSessionManager, 'openProject'>,
  runtimes: Pick<RuntimeBroker, 'client'>,
  projectId: string
): Promise<Result<OpenProjectSuccess, OpenProjectError>> {
  const project = await getProjectById(db, projectId);
  if (!project) return err({ type: 'error', message: `Project not found: ${projectId}` });

  const runtime = await runtimes.client(projectHostRef(project));
  if (!runtime.success) return err(runtime.error);
  const pathEntry = await runtime.data.files.fs.stat(
    fileKeyForAbsolutePath(hostPathFromNative(project.path))
  );
  if (!pathEntry.success && pathEntry.error.type !== 'not-found') {
    return err({ type: 'error', message: fsErrorMessage(pathEntry.error) });
  }
  if (!pathEntry.success || pathEntry.data.type !== 'directory') {
    return err({ type: 'path-not-found', path: project.path });
  }

  const result = await projects.openProject(project);
  if (!result.success) {
    return isRuntimeResolveError(result.error)
      ? err(result.error)
      : err({ type: 'error', message: result.error.message });
  }

  // The repository workspace row is registered eagerly at project creation;
  // pre-migration rows are backfilled by the release migration train.
  return ok({ repositoryWorkspaceId: project.repositoryWorkspaceId ?? null });
}
