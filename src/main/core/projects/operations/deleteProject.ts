import { eq, inArray } from 'drizzle-orm';
import { projectManager } from '@main/core/projects/project-manager';
import { getTasks } from '@main/core/tasks/getTasks';
import { viewStateService } from '@main/core/view-state/view-state-service';
import { db } from '@main/db/client';
import { projectRemotes, projects, pullRequests } from '@main/db/schema';
import { capture } from '@main/lib/telemetry';

export async function deleteProject(id: string): Promise<void> {
  const provider = projectManager.getProject(id);
  if (provider) {
    const projectTasks = await getTasks(id);
    await Promise.allSettled([
      ...projectTasks.map((t) => provider.teardownTask(t.id)),
      ...projectTasks.map((t) => viewStateService.del(`task:${t.id}`)),
    ]);
  }

  // Delete all pull requests synced for this project's remotes before removing
  // the project row. Child rows (labels, assignees, checks) cascade automatically.
  const remoteRows = await db
    .select({ remoteUrl: projectRemotes.remoteUrl })
    .from(projectRemotes)
    .where(eq(projectRemotes.projectId, id));

  if (remoteRows.length > 0) {
    const urls = remoteRows.map((r) => r.remoteUrl);
    await db.delete(pullRequests).where(inArray(pullRequests.repositoryUrl, urls));
  }

  await db.delete(projects).where(eq(projects.id, id));
  void viewStateService.del(`project:${id}`);
  await projectManager.closeProject(id);
  capture('project_deleted', { project_id: id });
}
