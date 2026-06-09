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
 * This is idempotent and race-safe — the INSERT and UPDATE are wrapped in a
 * transaction. If a concurrent call already inserted a workspace with the same
 * key, we recover by looking up the existing row by key and linking it.
 *
 * Called from `createLocalProject`/`createSshProject` (so the returned project
 * already carries the ID) and from `openProject` (for pre-migration rows).
 */
export function ensureRepositoryWorkspace(project: LocalProject | SshProject): string {
  const [row] = db
    .select({ repositoryWorkspaceId: projects.repositoryWorkspaceId })
    .from(projects)
    .where(eq(projects.id, project.id))
    .limit(1)
    .all();

  if (row?.repositoryWorkspaceId) return row.repositoryWorkspaceId;

  const workspaceId = randomUUID();
  const location = project.type === 'ssh' ? 'remote' : 'local';
  const sshConnectionId = project.type === 'ssh' ? project.connectionId : null;
  const legacyType = project.type === 'ssh' ? 'project-ssh' : 'local';
  const key = computeWorkspaceKey(legacyType, project.path, sshConnectionId ?? undefined);

  return db.transaction((tx) => {
    // Re-check inside the transaction to avoid races.
    const [current] = tx
      .select({ repositoryWorkspaceId: projects.repositoryWorkspaceId })
      .from(projects)
      .where(eq(projects.id, project.id))
      .limit(1)
      .all();

    if (current?.repositoryWorkspaceId) return current.repositoryWorkspaceId;

    // Check if a workspace with this key already exists (orphan from a previous
    // partial failure or concurrent insert).
    const [existingWs] = tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.key, key))
      .limit(1)
      .all();

    const resolvedId = existingWs?.id ?? workspaceId;

    if (!existingWs) {
      tx.insert(workspaces)
        .values({
          id: workspaceId,
          kind: 'project-root',
          location,
          sshConnectionId,
          type: legacyType,
          path: project.path,
          key,
        })
        .run();
    }

    tx.update(projects)
      .set({ repositoryWorkspaceId: resolvedId })
      .where(eq(projects.id, project.id))
      .run();

    log.info('ensureRepositoryWorkspace: created project-root workspace', {
      projectId: project.id,
      workspaceId: resolvedId,
      reusedExisting: !!existingWs,
    });

    return resolvedId;
  });
}
