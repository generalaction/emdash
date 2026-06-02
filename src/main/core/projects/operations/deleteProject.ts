import { eq } from 'drizzle-orm';
import { automationEvents } from '@main/core/automations/automation-events';
import { detachProject } from '@main/core/automations/service';
import { projectEvents } from '@main/core/projects/project-events';
import { projectManager } from '@main/core/projects/project-manager';
import { prSyncEngine } from '@main/core/pull-requests/pr-sync-engine';
import { getTasks } from '@main/core/tasks/operations/getTasks';
import { taskSessionManager } from '@main/core/tasks/task-session-manager';
import { viewStateService } from '@main/core/view-state/view-state-service';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';
import { telemetryService } from '@main/lib/telemetry';

export async function deleteProject(id: string): Promise<void> {
  const provider = projectManager.getProject(id);
  if (provider) {
    const projectTasks = await getTasks(id);
    await Promise.allSettled([
      ...projectTasks.map((t) => taskSessionManager.teardownTask(t.id)),
      ...projectTasks.map((t) => viewStateService.del(`task:${t.id}`)),
    ]);
    await projectManager.closeProject(id);
  }

  await prSyncEngine.deleteProjectData(id);
  await detachProject(id);
  await db.delete(projects).where(eq(projects.id, id));
  automationEvents._emit('automation:changed');
  void viewStateService.del(`project:${id}`);
  projectEvents._emit('project:deleted', id);
  telemetryService.capture('project_deleted', { project_id: id });
}
