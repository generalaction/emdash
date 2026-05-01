import { eq } from 'drizzle-orm';
import { automationsChangedChannel } from '@shared/events/automationEvents';
import { automationScheduler } from '@main/core/automations/automation-scheduler';
import { projectManager } from '@main/core/projects/project-manager';
import { prSyncEngine } from '@main/core/pull-requests/pr-sync-engine';
import { getTasks } from '@main/core/tasks/operations/getTasks';
import { taskManager } from '@main/core/tasks/task-manager';
import { viewStateService } from '@main/core/view-state/view-state-service';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';
import { events } from '@main/lib/events';
import { capture } from '@main/lib/telemetry';

export async function deleteProject(id: string): Promise<void> {
  const provider = projectManager.getProject(id);
  if (provider) {
    const projectTasks = await getTasks(id);
    await Promise.allSettled([
      ...projectTasks.map((t) => taskManager.teardownTask(t.id)),
      ...projectTasks.map((t) => viewStateService.del(`task:${t.id}`)),
    ]);
  }

  await prSyncEngine.deleteProjectData(id);

  await db.delete(projects).where(eq(projects.id, id));
  events.emit(automationsChangedChannel, undefined);
  await automationScheduler.reload();
  void viewStateService.del(`project:${id}`);
  await projectManager.closeProject(id);
  capture('project_deleted', { project_id: id });
}
