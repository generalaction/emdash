import { isRuntimeResolveError } from '@emdash/core/services/runtime-broker/api';
import { err, ok, type Result } from '@emdash/shared';
import type { ProjectAttachmentManager } from '@core/features/projects/api/node/project-attachment-manager';
import { type OpenProjectError, type OpenProjectSuccess } from '@core/primitives/projects/api';

export async function openProject(
  projects: Pick<ProjectAttachmentManager, 'openProject'>,
  projectId: string
): Promise<Result<OpenProjectSuccess, OpenProjectError>> {
  const result = await projects.openProject(projectId);
  if (!result.success) {
    if (isRuntimeResolveError(result.error)) return err(result.error);
    switch (result.error.type) {
      case 'repository-missing':
        return err({ type: 'path-not-found', path: result.error.path });
      case 'repository-unavailable':
      case 'unexpected':
        return err({ type: 'error', message: result.error.message });
      case 'project-missing':
        return err({ type: 'error', message: `Project not found: ${result.error.projectId}` });
      case 'attachment-unavailable':
        return err({ type: 'error', message: 'Project attachment is not ready' });
    }
  }

  // The repository workspace row is registered eagerly at project creation;
  // pre-migration rows are backfilled by the release migration train.
  return ok({ repositoryWorkspaceId: result.data.project.repositoryWorkspaceId ?? null });
}
