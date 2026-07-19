import { eq } from 'drizzle-orm';
import { projectEvents } from '@main/core/projects/project-events';
import { projectManager } from '@main/core/projects/project-manager';
import { prSyncEngine } from '@main/core/pull-requests/pr-sync-engine';
import { getTasks } from '@main/core/tasks/operations/getTasks';
import { taskSessionManager } from '@main/core/tasks/task-session-manager';
import { viewStateService } from '@main/core/view-state/view-state-service';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';
import { telemetryService } from '@main/lib/telemetry';

export async function deleteProject(id: string): Promise<string[]> {
  const provider = projectManager.getProject(id);
  const projectTasks = await getTasks(id);
  if (provider) {
    await Promise.allSettled([...projectTasks.map((t) => taskSessionManager.teardownTask(t.id))]);
    await projectManager.closeProject(id);
  }

  await Promise.allSettled([
    viewStateService.del(`project:${id}`),
    ...projectTasks.flatMap((task) => [
      viewStateService.del(`task:${task.id}`),
      viewStateService.del(`task:${task.id}:tabs`),
    ]),
  ]);

  await prSyncEngine.deleteProjectData(id);
  await db.delete(projects).where(eq(projects.id, id));
  projectEvents._emit('project:deleted', id);
  telemetryService.capture('project_deleted', { project_id: id });
  return projectTasks.map((task) => task.id);
}
