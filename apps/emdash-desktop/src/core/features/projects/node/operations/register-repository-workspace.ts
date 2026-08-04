import { randomUUID } from 'node:crypto';
import type { HostRef } from '@emdash/core/primitives/host/api';
import { log } from '@emdash/shared/logger';
import { and, eq, isNull } from 'drizzle-orm';
import { createWorkspaceRegistry } from '@core/features/workspaces/api/node/registry';
import { workspaceHostStorage } from '@core/features/workspaces/api/node/workspace-identity-service';
import type { AppDb } from '@core/services/app-db/node/db';
import { appDbPokes } from '@core/services/app-db/node/pokes';
import { projects } from '@core/services/app-db/node/schema';

/**
 * Registers the project's repository workspace row and sets
 * `projects.repositoryWorkspaceId` if it is not already set. The repository
 * row owns the project's path and host identity.
 *
 * This is idempotent and race-safe — the INSERT and UPDATE are wrapped in a
 * transaction. If a live workspace row already exists at the project's host +
 * path (an orphan from a previous partial failure, or an adopted row), it is
 * linked instead of inserting a duplicate.
 *
 * Called only from `createProjectOnHost`: project creation is the sole
 * registration site. Pre-existing rows without a repository workspace are
 * backfilled by the release migration train.
 */
export function registerRepositoryWorkspace(
  db: AppDb,
  project: { id: string; path: string; host: HostRef }
): string {
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
  const storage = workspaceHostStorage(project.host);
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

    const existingWs = registry.findLiveByPath(
      storage.location,
      storage.sshConnectionId,
      project.path,
      tx
    );

    const resolvedId = existingWs?.id ?? workspaceId;

    if (!existingWs) {
      registry.register(
        {
          id: workspaceId,
          kind: 'repository',
          location: storage.location,
          sshConnectionId: storage.sshConnectionId,
          type: storage.type,
          path: project.path,
        },
        tx
      );
    } else if (existingWs.kind !== 'repository' && existingWs.kind !== 'worktree') {
      // Directory rows at the project path get promoted; worktree rows keep
      // their kind — flipping one would suppress its branch identity and
      // block worktree removal for the task that owns it.
      registry.annotate(existingWs.id, { kind: 'repository' }, tx);
    }

    tx.update(projects)
      .set({ repositoryWorkspaceId: resolvedId })
      .where(and(eq(projects.id, project.id), isNull(projects.deletedAt)))
      .run();

    log.info('registerRepositoryWorkspace: created repository workspace', {
      projectId: project.id,
      workspaceId: resolvedId,
      reusedExisting: !!existingWs,
    });

    return resolvedId;
  });
  appDbPokes.projects.poke({ projectId: project.id });
  return resolvedId;
}
