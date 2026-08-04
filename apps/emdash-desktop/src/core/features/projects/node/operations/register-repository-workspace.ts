import { randomUUID } from 'node:crypto';
import { log } from '@emdash/shared/logger';
import { and, eq, isNull } from 'drizzle-orm';
import { createWorkspaceRegistry } from '@core/features/workspaces/api/node/registry';
import { computeWorkspaceKey } from '@core/features/workspaces/api/node/workspace-key';
import type { LocalProject, SshProject } from '@core/primitives/projects/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { appDbPokes } from '@core/services/app-db/node/pokes';
import { projects } from '@core/services/app-db/node/schema';

/**
 * Eagerly registers the project's `project-root` workspace row and sets
 * `projects.repositoryWorkspaceId` if it is not already set.
 *
 * This is idempotent and race-safe — the INSERT and UPDATE are wrapped in a
 * transaction. If a previous partial failure left an orphaned workspace row
 * with the same key, we recover by looking up the existing row and linking it.
 *
 * Called only from `createProjectOnHost`: project creation is the sole
 * registration site. Pre-existing rows without a repository workspace are
 * backfilled by the release migration train.
 */
export function registerRepositoryWorkspace(db: AppDb, project: LocalProject | SshProject): string {
  const [row] = db
    .select({ repositoryWorkspaceId: projects.repositoryWorkspaceId })
    .from(projects)
    .where(and(eq(projects.id, project.id), isNull(projects.deletedAt)))
    .limit(1)
    .all();

  if (row?.repositoryWorkspaceId) {
    return row.repositoryWorkspaceId;
  }

  const workspaceId = randomUUID();
  const location = project.type === 'ssh' ? 'remote' : 'local';
  const sshConnectionId = project.type === 'ssh' ? project.connectionId : null;
  const legacyType = project.type === 'ssh' ? 'project-ssh' : 'local';
  const key = computeWorkspaceKey(legacyType, project.path, sshConnectionId ?? undefined);
  const registry = createWorkspaceRegistry(db);

  const resolvedId = db.transaction((tx) => {
    // Re-check inside the transaction to avoid races.
    const [current] = tx
      .select({ repositoryWorkspaceId: projects.repositoryWorkspaceId })
      .from(projects)
      .where(and(eq(projects.id, project.id), isNull(projects.deletedAt)))
      .limit(1)
      .all();

    if (current?.repositoryWorkspaceId) return current.repositoryWorkspaceId;

    // Check if a workspace with this key already exists (orphan from a previous
    // partial failure or concurrent insert).
    const existingWs = registry.findLiveByKey(key, tx);

    const resolvedId = existingWs?.id ?? workspaceId;

    if (!existingWs) {
      registry.register(
        {
          id: workspaceId,
          kind: 'project-root',
          location,
          sshConnectionId,
          type: legacyType,
          path: project.path,
          key,
        },
        tx
      );
    }

    tx.update(projects)
      .set({ repositoryWorkspaceId: resolvedId })
      .where(and(eq(projects.id, project.id), isNull(projects.deletedAt)))
      .run();

    log.info('registerRepositoryWorkspace: created project-root workspace', {
      projectId: project.id,
      workspaceId: resolvedId,
      reusedExisting: !!existingWs,
    });

    return resolvedId;
  });
  appDbPokes.projects.poke({ projectId: project.id });
  return resolvedId;
}
