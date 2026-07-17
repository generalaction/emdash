import { projectEvents } from '@main/core/projects/project-events';
import { projectManager } from '@main/core/projects/project-manager';
import { viewStateService } from '@main/core/view-state/view-state-service';
import { pullRequestsRegistration } from '@main/core/wire-workers/pull-requests-registration';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';

export async function purgeTaskLocalState(input: {
  projectId?: string | null;
  taskId: string;
}): Promise<void> {
  await Promise.all([
    viewStateService.del(`task:${input.taskId}`),
    viewStateService.del(`task:${input.taskId}:tabs`),
  ]);
  telemetryService.capture('task_deleted', {
    project_id: input.projectId ?? undefined,
    task_id: input.taskId,
  });
}

export async function purgeProjectLocalState(
  projectId: string,
  purgeDatabaseRows: () => Promise<void>
): Promise<void> {
  await pullRequestsRegistration.deleteProjectData(projectId);
  await projectManager.closeProject(projectId).catch((error) => {
    log.warn('operation: failed to close project before purge', {
      projectId,
      error: String(error),
    });
  });
  await purgeDatabaseRows();
  await viewStateService.del(`project:${projectId}`);
  projectEvents._emit('project:deleted', projectId);
  telemetryService.capture('project_deleted', { project_id: projectId });
}
