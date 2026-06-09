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

    const [updatedRow] = await db
      .update(projects)
      .set({ name: trimmedName, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(projects.id, projectId))
      .returning();
    if (!updatedRow) return err({ type: 'project-not-found' });

    const project: Project =
      updatedRow.workspaceProvider === 'local'
        ? {
            type: 'local',
            id: updatedRow.id,
            name: updatedRow.name,
            path: updatedRow.path,
            baseRef: updatedRow.baseRef ?? 'main',
            createdAt: updatedRow.createdAt,
            updatedAt: updatedRow.updatedAt,
          }
        : {
            type: 'ssh',
            id: updatedRow.id,
            name: updatedRow.name,
            path: updatedRow.path,
            baseRef: updatedRow.baseRef ?? 'main',
            connectionId: updatedRow.sshConnectionId!,
            createdAt: updatedRow.createdAt,
            updatedAt: updatedRow.updatedAt,
          };
    projectEvents._emit('project:renamed', project);
    return ok(project);
  } catch (e) {
    return err({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}
