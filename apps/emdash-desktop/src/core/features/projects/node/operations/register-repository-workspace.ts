import type { HostRef } from '@emdash/core/primitives/host/api';
import type { WorkspaceRecord } from '@emdash/core/runtimes/workspace-registry/api';
import { err, ok, type Result } from '@emdash/shared';
import { log } from '@emdash/shared/logger';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  createWorkspaceRegistry,
  type WorkspaceClaimError,
} from '@core/features/workspaces/api/node/registry';
import { workspaceHostStorage } from '@core/features/workspaces/api/node/workspace-identity-service';
import {
  storedIntegrationAccountsSchema,
  type StoredIntegrationAccounts,
} from '@core/primitives/project-settings/api/project-settings';
import type { AppDb } from '@core/services/app-db/node/db';
import { projects, projectSettings, type ProjectRow } from '@core/services/app-db/node/schema';

export type RegisterRepositoryWorkspaceError =
  | WorkspaceClaimError
  | { type: 'project-already-linked'; projectId: string; workspaceId: string };

export type RegisterRepositoryWorkspaceInput = {
  project: { id: string; name: string; baseRef: string | null };
  host: HostRef;
  record: WorkspaceRecord;
  initialIntegrationAccounts?: StoredIntegrationAccounts;
};

/**
 * Commits one Project and its Host-acknowledged Repository identity atomically. The
 * Host call intentionally happens before this module: a failed desktop transaction
 * leaves only an unassociated Host record, which snapshot Observe can safely mirror.
 */
export function registerRepositoryWorkspace(
  db: AppDb,
  input: RegisterRepositoryWorkspaceInput
): Result<ProjectRow, RegisterRepositoryWorkspaceError> {
  const registry = createWorkspaceRegistry(db);
  const { location, sshConnectionId } = workspaceHostStorage(input.host);

  return db.transaction((tx) => {
    const linked = tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.repositoryWorkspaceId, input.record.id), isNull(projects.deletedAt)))
      .limit(1)
      .get();
    if (linked) {
      return err({
        type: 'project-already-linked',
        projectId: linked.id,
        workspaceId: input.record.id,
      });
    }

    const claimed = registry.claim(
      {
        host: { location, sshConnectionId },
        record: input.record,
      },
      tx
    );
    if (!claimed.success) return claimed;

    const row = tx
      .insert(projects)
      .values({
        ...input.project,
        repositoryWorkspaceId: input.record.id,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .returning()
      .get();
    // Initial account intent and project identity commit together. Failure to
    // persist a pin must never publish a project that silently uses a default.
    if (input.initialIntegrationAccounts !== undefined) {
      tx.insert(projectSettings)
        .values({
          projectId: row.id,
          baseProjectSettingsJson: JSON.stringify({
            integrationAccounts: storedIntegrationAccountsSchema.parse(
              input.initialIntegrationAccounts
            ),
          }),
        })
        .run();
    }
    log.info('registerRepositoryWorkspace: claimed canonical repository workspace', {
      projectId: row.id,
      workspaceId: input.record.id,
    });
    return ok(row);
  });
}
