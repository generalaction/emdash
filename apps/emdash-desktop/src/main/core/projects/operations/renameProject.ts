import { eq, sql } from 'drizzle-orm';
import { projectEvents } from '@main/core/projects/project-events';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';
import { MAX_PROJECT_NAME_LENGTH, type Project } from '@shared/projects';

export async function renameProject(projectId: string, name: string): Promise<void> {
  const trimmedName = name.trim();
  if (!trimmedName || trimmedName.length > MAX_PROJECT_NAME_LENGTH) {
    throw new Error('Project name is invalid.');
  }

  const [updatedRow] = await db
    .update(projects)
    .set({ name: trimmedName, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(projects.id, projectId))
    .returning();
  if (!updatedRow) throw new Error('Project not found.');

  const project: Project =
    updatedRow.workspaceProvider === 'local'
      ? {
          type: 'local',
          id: updatedRow.id,
          name: updatedRow.name,
          path: updatedRow.path,
          baseRef: updatedRow.baseRef ?? 'main',
          repositoryWorkspaceId: updatedRow.repositoryWorkspaceId,
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
          repositoryWorkspaceId: updatedRow.repositoryWorkspaceId,
          createdAt: updatedRow.createdAt,
          updatedAt: updatedRow.updatedAt,
        };
  projectEvents._emit('project:renamed', project);
}
