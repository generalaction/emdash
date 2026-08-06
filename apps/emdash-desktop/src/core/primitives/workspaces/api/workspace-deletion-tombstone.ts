import { defineVersionedSchema } from '@emdash/core/primitives/versioned-schema/api';
import z from 'zod';

// Durable deletion intent on the workspaces mirror (ADR 0006): written atomically at
// delete time when the host is unreachable. The tombstoned row *is* the durable intent
// and the queue — the reconcile sweep executes it against a reachable host and purges
// the tombstone once the mirror confirms the record gone. Nothing rides an operation log.

const deletionTombstoneV1 = z.object({
  version: z.literal('1'),
  /**
   * The target host record's UUID, frozen at tombstone time (identity-keyed removal):
   * the delete verbs are UUID-keyed and no-op on absent ids, so a new record at the
   * old path is never touched by an old tombstone.
   */
  targetRecordId: z.string(),
  /** Epoch-ms write stamp; display only, never an expiry (ADR 0006 keeps no timer). */
  tombstonedAt: z.number(),
  /** Deletion options decided in the delete UI, frozen at tombstone time. */
  options: z.object({
    deleteBranch: z.boolean(),
    /** Opt-in cascade to the workspace's conversation records (spec §7.1). */
    deleteConversations: z.boolean(),
  }),
});

export const workspaceDeletionTombstone = defineVersionedSchema()
  .initial('1', deletionTombstoneV1)
  .build();
export type WorkspaceDeletionTombstone = typeof workspaceDeletionTombstone.Type;
