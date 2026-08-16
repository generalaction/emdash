import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import type { ProjectAttachmentManager } from '@core/features/projects/api/node/project-attachment-manager';
import {
  createWorkspaceRegistry,
  liveWorkspaces,
  workspaceRegistryTable as workspaces,
} from '@core/features/workspaces/api/node/registry';
import type { AppDb } from '@core/services/app-db/node/db';
import { appDbPokes } from '@core/services/app-db/node/pokes';
import { projects, tasks } from '@core/services/app-db/node/schema';

/**
 * Re-points an SSH project at a different connection. Host identity lives on
 * the workspace rows, so the repository row and every live remote workspace
 * of the project move together.
 */
export async function updateProjectConnection(
  db: AppDb,
  attachments: Pick<ProjectAttachmentManager, 'invalidate'>,
  projectId: string,
  connectionId: string
): Promise<void> {
  const [row] = await db
    .select({ repositoryWorkspaceId: projects.repositoryWorkspaceId })
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)));
  if (!row) throw new Error(`Project ${projectId} not found`);
  if (!row.repositoryWorkspaceId) {
    throw new Error(`Project ${projectId} has no repository workspace`);
  }

  const registry = createWorkspaceRegistry(db);
  const repository = registry.getLive(row.repositoryWorkspaceId);
  if (repository?.location !== 'remote') {
    throw new Error(`Project ${projectId} is not an SSH project`);
  }

  const taskWorkspaceRows = await db
    .select({ workspaceId: tasks.workspaceId })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt)));
  const candidateIds = new Set<string>([repository.id]);
  for (const taskRow of taskWorkspaceRows) {
    if (taskRow.workspaceId) candidateIds.add(taskRow.workspaceId);
  }
  const remoteRows = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(
      and(
        or(inArray(workspaces.id, [...candidateIds]), eq(workspaces.parentId, repository.id)),
        eq(workspaces.location, 'remote'),
        liveWorkspaces()
      )
    );

  db.transaction((tx) => {
    for (const remoteRow of remoteRows) {
      registry.annotate(remoteRow.id, { sshConnectionId: connectionId }, tx);
    }
    tx.update(projects)
      .set({ updatedAt: new Date().toISOString() })
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .run();
  });
  appDbPokes.projects.poke({ projectId });
  appDbPokes.workspaces.poke({ projectId });
  await attachments.invalidate(projectId, 'relink');
}
