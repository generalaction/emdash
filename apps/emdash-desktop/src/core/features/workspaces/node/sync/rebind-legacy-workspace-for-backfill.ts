import { isDeepEqual, err, type Result } from '@emdash/shared';
import { and, eq, isNull } from 'drizzle-orm';
import {
  createWorkspaceRegistry,
  workspaceRegistryTable as workspaces,
  type WorkspaceClaimError,
  type WorkspaceClaimInput,
} from '@core/features/workspaces/api/node/registry';
import type { AppDb } from '@core/services/app-db/node/db';
import { projects, tasks, type WorkspaceRow } from '@core/services/app-db/node/schema';

export type LegacyWorkspaceRebindError =
  | WorkspaceClaimError
  | { type: 'legacy-workspace-missing'; legacyId: string }
  | { type: 'workspace-annotation-conflict'; workspaceId: string; field: 'config' }
  | {
      type: 'workspace-binding-conflict';
      legacyId: string;
      canonicalId: string;
      binding: 'project';
    };

/**
 * Applies the exceptional legacy-id -> Host-id mapping produced during the one-time
 * production backfill. The ordinary same-id path uses Claim and never enters here.
 *
 * The old mirror row must still be exactly the row planned by the backfill. All desktop
 * bindings move in one transaction; the obsolete row remains untracked as cutover
 * history and its desktop-owned config moves to the canonical row.
 */
export function rebindLegacyWorkspaceForBackfill(
  db: AppDb,
  legacyId: string,
  input: WorkspaceClaimInput,
  expectedLegacyPath: string
): Result<WorkspaceRow, LegacyWorkspaceRebindError> {
  if (legacyId === input.record.id) {
    throw new Error('Legacy workspace rebinding requires different legacy and canonical ids');
  }

  const registry = createWorkspaceRegistry(db);
  try {
    return db.transaction((tx) => {
      const legacy = tx.select().from(workspaces).where(eq(workspaces.id, legacyId)).limit(1).get();
      if (!legacy) return err({ type: 'legacy-workspace-missing', legacyId });
      if (legacy.deletionTombstone !== null) {
        return err({ type: 'workspace-tombstoned', workspaceId: legacyId });
      }
      if (
        legacy.untrackedAt !== null ||
        legacy.location !== input.host.location ||
        legacy.sshConnectionId !== input.host.sshConnectionId ||
        legacy.path !== expectedLegacyPath
      ) {
        return identityConflict(input, legacyId);
      }

      const canonical = tx
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, input.record.id))
        .limit(1)
        .get();
      if (canonical?.deletionTombstone !== null && canonical?.deletionTombstone !== undefined) {
        return err({ type: 'workspace-tombstoned', workspaceId: input.record.id });
      }
      if (
        canonical &&
        (canonical.location !== input.host.location ||
          canonical.sshConnectionId !== input.host.sshConnectionId)
      ) {
        return identityConflict(input, canonical.id);
      }

      const pathOwner = registry.findLiveByPath(
        input.host.location,
        input.host.sshConnectionId,
        input.record.path,
        tx
      );
      if (pathOwner && pathOwner.id !== legacyId && pathOwner.id !== input.record.id) {
        return identityConflict(input, pathOwner.id);
      }

      const legacyConfig = legacy.config;
      const canonicalConfig = canonical?.config ?? input.config ?? null;
      if (
        legacyConfig !== null &&
        canonicalConfig !== null &&
        !isDeepEqual(legacyConfig, canonicalConfig)
      ) {
        return err({
          type: 'workspace-annotation-conflict',
          workspaceId: input.record.id,
          field: 'config',
        });
      }

      const legacyProject = tx
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.repositoryWorkspaceId, legacyId), isNull(projects.deletedAt)))
        .limit(1)
        .get();
      const canonicalProject = tx
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.repositoryWorkspaceId, input.record.id), isNull(projects.deletedAt)))
        .limit(1)
        .get();
      if (legacyProject && canonicalProject && legacyProject.id !== canonicalProject.id) {
        return err({
          type: 'workspace-binding-conflict',
          legacyId,
          canonicalId: input.record.id,
          binding: 'project',
        });
      }

      const changed = registry.untrack([legacyId], new Date().toISOString(), undefined, tx);
      if (changed !== 1) {
        throw new RebindAborted({ type: 'legacy-workspace-missing', legacyId });
      }
      registry.updateConfig(legacyId, null, tx);
      const claimed = registry.claim(
        { ...input, config: canonicalConfig ?? legacyConfig ?? undefined },
        tx
      );
      if (!claimed.success) throw new RebindAborted(claimed.error);

      tx.update(projects)
        .set({ repositoryWorkspaceId: input.record.id, updatedAt: new Date().toISOString() })
        .where(eq(projects.repositoryWorkspaceId, legacyId))
        .run();
      tx.update(tasks)
        .set({ workspaceId: input.record.id, updatedAt: new Date().toISOString() })
        .where(eq(tasks.workspaceId, legacyId))
        .run();
      tx.update(workspaces)
        .set({ parentId: input.record.id, updatedAt: new Date().toISOString() })
        .where(eq(workspaces.parentId, legacyId))
        .run();
      return claimed;
    });
  } catch (error) {
    if (error instanceof RebindAborted) return err(error.error);
    throw error;
  }
}

function identityConflict(
  input: WorkspaceClaimInput,
  conflictingId: string
): Result<never, LegacyWorkspaceRebindError> {
  return err({
    type: 'workspace-identity-conflict',
    path: input.record.path,
    incomingId: input.record.id,
    conflictingId,
  });
}

class RebindAborted extends Error {
  constructor(readonly error: LegacyWorkspaceRebindError) {
    super(error.type);
  }
}
