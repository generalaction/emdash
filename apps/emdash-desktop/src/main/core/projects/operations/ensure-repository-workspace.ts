import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { computeWorkspaceKey } from '@main/core/workspaces/workspace-key';
import { db } from '@main/db/client';
import { projects, workspaces } from '@main/db/schema';
import { log } from '@main/lib/logger';
import type { LocalProject, SshProject } from '@shared/projects';

/**
 * Ensures the project has a `project-root` workspace row and sets
 * `projects.repositoryWorkspaceId` if it is not already set.
 *
 * This is idempotent — if `repositoryWorkspaceId` is already populated the
 * function returns immediately without touching the DB.  Called from
 * `openProject` so that every project gets its shared repository workspace on
 * first mount after the migration.
 */
export async function ensureRepositoryWorkspace(
  project: LocalProject | SshProject
): Promise<string> {
  const [row] = await db
    .select({ repositoryWorkspaceId: projects.repositoryWorkspaceId })
    .from(projects)
    .where(eq(projects.id, project.id))
    .limit(1);

  if (row?.repositoryWorkspaceId) return row.repositoryWorkspaceId;

  const workspaceId = randomUUID();
  const location = project.type === 'ssh' ? 'remote' : 'local';
  const sshConnectionId = project.type === 'ssh' ? project.connectionId : null;
  const legacyType = project.type === 'ssh' ? 'project-ssh' : 'local';
  const key = computeWorkspaceKey(legacyType, project.path, sshConnectionId ?? undefined);

  await db.insert(workspaces).values({
    id: workspaceId,
    kind: 'project-root',
    location,
    sshConnectionId,
    type: legacyType,
    path: project.path,
    key,
  });

  await db
    .update(projects)
    .set({ repositoryWorkspaceId: workspaceId })
    .where(eq(projects.id, project.id));

  log.info('ensureRepositoryWorkspace: created project-root workspace', {
    projectId: project.id,
    workspaceId,
  });

  return workspaceId;
}
