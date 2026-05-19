import { eq } from 'drizzle-orm';
import { automationEvents } from '@main/core/automations/automation-events';
import { projectEvents } from '@main/core/projects/project-events';
import { projectManager } from '@main/core/projects/project-manager';
import { getTasks } from '@main/core/tasks/operations/getTasks';
import { taskManager } from '@main/core/tasks/task-manager';
import { viewStateService } from '@main/core/view-state/view-state-service';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';
import { telemetryService } from '@main/lib/telemetry';

export async function deleteProject(id: string): Promise<void> {
  const provider = projectManager.getProject(id);
  if (provider) {
    const projectTasks = await getTasks(id);
    await Promise.allSettled([
      ...projectTasks.map((t) => taskManager.teardownTask(t.id)),
      ...projectTasks.map((t) => viewStateService.del(`task:${t.id}`)),
    ]);
  }

  await db.delete(projects).where(eq(projects.id, id));
  automationEvents._emit('automation:changed');
  void viewStateService.del(`project:${id}`);
  projectEvents._emit('project:deleted', id);
  await projectManager.closeProject(id);
  telemetryService.capture('project_deleted', { project_id: id });
}
