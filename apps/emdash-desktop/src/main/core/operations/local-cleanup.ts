import { projectSubject } from '@core/features/projects/contributions/subject';
import { taskSubject } from '@core/features/tasks/contributions/subject';
import { tasks } from '@core/services/app-db/node/schema';
import { pullRequestsRegistration } from '@core/services/pull-requests/node/pull-requests-registration';
import { automationsService } from '@main/core/automations/automations-service';
import { projectEvents } from '@main/core/projects/project-events';
import { projectManager } from '@main/core/projects/project-manager';
import { getAppDb } from '@main/db/instance';
import { getMementosRuntimeClient } from '@main/gateway/desktop-workers';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';

export async function purgeTaskLocalState(input: {
  projectId?: string | null;
  taskId: string;
}): Promise<void> {
  const client = await getMementosRuntimeClient();
  const result = await client.deleteBySubject(taskSubject({ taskId: input.taskId }));
  if (!result.success) throw new Error(result.error.message);
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
  await automationsService.removeProjectDeployments(projectId);
  await purgeDatabaseRows();
  const client = await getMementosRuntimeClient();
  const taskRows = await getAppDb().select({ id: tasks.id }).from(tasks);
  const [projectResult, taskResult] = await Promise.all([
    client.deleteBySubject(projectSubject({ projectId })),
    client.deleteOrphans({ kind: taskSubject.kind, validKeys: taskRows.map(({ id }) => id) }),
  ]);
  if (!projectResult.success) throw new Error(projectResult.error.message);
  if (!taskResult.success) throw new Error(taskResult.error.message);
  projectEvents._emit('project:deleted', projectId);
  telemetryService.capture('project_deleted', { project_id: projectId });
}
