import { eq, sql } from 'drizzle-orm';
import { projectEvents } from '@main/core/projects/project-events';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';
import { MAX_PROJECT_NAME_LENGTH, type Project, type RenameProjectError } from '@shared/projects';
import { err, ok, type Result } from '@shared/result';
import { getProjectById } from './getProjects';

export async function renameProject(
  projectId: string,
  name: string
): Promise<Result<Project, RenameProjectError>> {
  const trimmedName = name.trim();
  if (!trimmedName || trimmedName.length > MAX_PROJECT_NAME_LENGTH) {
    return err({ type: 'invalid-name' });
  }

  try {
    const existingProject = await getProjectById(projectId);
    if (!existingProject) return err({ type: 'project-not-found' });
    if (existingProject.name === trimmedName) return ok(existingProject);

    const [row] = await db
      .update(projects)
      .set({ name: trimmedName, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(projects.id, projectId))
      .returning({ id: projects.id });
    if (!row) return err({ type: 'project-not-found' });

    const project = await getProjectById(projectId);
    if (!project) return err({ type: 'project-not-found' });
    projectEvents._emit('project:renamed', project);
    return ok(project);
  } catch (e) {
    return err({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}
