import { isLocalHostRef, type HostRef } from '@emdash/core/primitives/host/api';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import {
  cascadeTombstonedConversationDeletions,
  type WorkspaceRemovalBroker,
} from '@core/features/workspaces/api/node/operations/workspace-removal';
import {
  createWorkspaceRegistry,
  liveWorkspaces,
  workspaceRegistryTable as workspaces,
} from '@core/features/workspaces/api/node/registry';
import { appDbPokes } from '@core/services/app-db/node/pokes';
import type { OperationSubmitter } from '@core/services/operations/api/node';
import type {
  ReconcileSweepKind,
  ReconcileTombstone,
} from '@core/services/reconcile-sweep/node/reconcile-sweep-service';

/**
 * The workspaces registration for the entity-generic reconcile sweep (ADR 0006):
 * pending tombstones are live mirror rows carrying a `deletionTombstone`, removal is
 * the registry's idempotent `deleteWorktree`/`deleteWorkspace` verb called with the
 * tombstone's frozen options and target record UUID, and gone-confirmation is the
 * sync path having untracked the row (the snapshot application purges tombstoned rows
 * once a delivery no longer carries the record).
 */
export function createWorkspaceDeletionSweepKind(options: {
  operations: OperationSubmitter;
  runtimes: WorkspaceRemovalBroker;
}): ReconcileSweepKind {
  const { operations, runtimes } = options;
  return {
    kind: 'workspaces',

    async readTombstones(host: HostRef): Promise<readonly ReconcileTombstone[]> {
      const rows = operations.db
        .select()
        .from(workspaces)
        .where(
          and(liveWorkspaces(), hostIdentityFilter(host), isNotNull(workspaces.deletionTombstone))
        )
        .all();
      return rows.flatMap((row) => {
        if (row.deletionTombstone === null) return [];
        return [
          {
            id: row.id,
            tombstonedAt: row.deletionTombstone.tombstonedAt,
            lastRemovalAttempt: row.lastRemovalAttempt
              ? { class: row.lastRemovalAttempt.class, at: row.lastRemovalAttempt.at }
              : null,
          },
        ];
      });
    },

    async executeRemoval(host, id) {
      const row = createWorkspaceRegistry(operations.db).getLive(id);
      const tombstone = row?.deletionTombstone ?? null;
      // The row vanished under the sweep (forget-host, sync purge): nothing to issue,
      // nothing to assert.
      if (!row || tombstone === null) return 'ok';
      const client = await runtimes.client(host);
      if (!client.success) return 'unreachable';
      const verbs = client.data.workspaceRegistry;
      // Identity-keyed removal: the verb targets the frozen record UUID, so a new
      // record at the old path is never touched and an absent id is a no-op success.
      const removed =
        row.kind === 'worktree'
          ? await verbs.deleteWorktree({
              id: tombstone.targetRecordId,
              deleteBranch: tombstone.options.deleteBranch,
            })
          : await verbs.deleteWorkspace({ id: tombstone.targetRecordId });
      if (!removed.success) {
        return removed.error.type === 'host-unreachable' ? 'unreachable' : 'failed';
      }
      // The frozen opt-in cascade, compiled at sweep time (spec §7.1) — same shape as
      // the reachable-host delete path. The workspace tombstone itself still waits
      // for mirror confirmation; only the RPC's positive success runs the cascade.
      if (tombstone.options.deleteConversations) {
        await cascadeTombstonedConversationDeletions(operations, {
          workspacePath: row.path ?? undefined,
          host,
          createdAt: Date.now(),
        });
        appDbPokes.conversations.poke({});
      }
      return 'ok';
    },

    async confirmGone(_host, id) {
      // The sync snapshot application untracks tombstoned rows once a delivery
      // confirms the record absent — a row no longer live is a purged tombstone.
      return createWorkspaceRegistry(operations.db).getLive(id) === undefined;
    },
  };
}

function hostIdentityFilter(host: HostRef) {
  return isLocalHostRef(host)
    ? and(eq(workspaces.location, 'local'), isNull(workspaces.sshConnectionId))
    : and(eq(workspaces.location, 'remote'), eq(workspaces.sshConnectionId, host.id));
}
