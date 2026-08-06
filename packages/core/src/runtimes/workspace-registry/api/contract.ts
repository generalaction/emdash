import { defineContract, fallible, liveModel, liveState } from '@emdash/wire/rpc';
import { z } from 'zod';
import {
  activateWorkspaceErrorSchema,
  createWorkspaceErrorSchema,
  createWorktreeErrorSchema,
  deleteWorkspaceErrorSchema,
  deleteWorktreeErrorSchema,
  workspaceNotFoundErrorSchema,
} from './errors';
import {
  activateWorkspaceInputSchema,
  createWorkspaceInputSchema,
  createWorktreeInputSchema,
  deactivateWorkspaceInputSchema,
  deleteWorkspaceInputSchema,
  deleteWorktreeInputSchema,
  refreshWorkspacesInputSchema,
  workspaceRecordSchema,
  workspaceRecordsSchema,
} from './schemas';

/**
 * The host workspace registry (ADR 0005): a durable, sole-writer index of registered
 * paths plus host-computed observations. The filesystem stays the source of truth — the
 * registry observes it and never converges the world toward a record. Lifecycle verbs
 * are plain fail-fast RPCs; no outbox, no durable operations, no job objects. Progress
 * and current state are read from `records`, which merges durable rows with the
 * in-memory runtime overlay.
 */
export const workspaceRegistryContract = defineContract({
  /**
   * Sole read path. Full map on subscribe; durable records merged with the in-memory
   * runtime overlay; republished on every registry mutation, overlay change, and scan
   * result. Desktops apply every delivery as a full snapshot.
   */
  records: liveModel({
    key: z.void().optional(),
    states: {
      list: liveState({ data: workspaceRecordsSchema }),
    },
  }),

  /**
   * Register an existing path. Kind is host-detected; registering a worktree of an
   * unregistered repository auto-registers the parent (adopted). Replay: same id + same
   * path is a no-op success; a different path under the same id is an
   * immutable-field-mismatch; the same path under a different id returns
   * already-registered carrying the existing record.
   */
  createWorkspace: fallible({
    input: createWorkspaceInputSchema,
    data: workspaceRecordSchema,
    error: createWorkspaceErrorSchema,
  }),

  /**
   * Creates a worktree from a repository spec as one plain RPC: registers the record
   * immediately (outcome 'started'), executes inspect → fetch → add-worktree → verify →
   * copy-preserved-files → push-branch under an exclusive per-repository claim
   * (concurrent same-repo calls wait, never error), and returns on completion. Progress
   * is the records overlay — no job objects. Replay by id + identical spec: succeeded →
   * no-op success; failed/interrupted → re-execute; divergent spec → typed mismatch.
   */
  createWorktree: fallible({
    input: createWorktreeInputSchema,
    data: workspaceRecordSchema,
    error: createWorktreeErrorSchema,
  }),

  /**
   * Returns when the prepare script completes (the session-gating point); setup runs
   * after, concurrent with sessions; run waits on setup success. Script failures —
   * prepare included — surface as notices in the runtime overlay and never fail the
   * verb. Activation is ephemeral: it lives in the overlay and dies with the daemon;
   * only lastActivatedAt persists, as an observation. Re-activating an active
   * workspace is a no-op success.
   */
  activateWorkspace: fallible({
    input: activateWorkspaceInputSchema,
    data: workspaceRecordSchema,
    error: activateWorkspaceErrorSchema,
  }),

  /**
   * The sole owner of session-plane shutdown (ADR 0005, superseding ADR 0003): kills
   * every session under the workspace path, then runs the teardown script time-boxed
   * and non-fatal — a failed or hanging teardown becomes a notice, never a verb error.
   * Idempotent on inactive workspaces: teardown runs at most once per activation.
   */
  deactivateWorkspace: fallible({
    input: deactivateWorkspaceInputSchema,
    data: z.void(),
    error: workspaceNotFoundErrorSchema,
  }),

  /**
   * Deactivate-if-active + unregister. Never touches disk, valid on every kind.
   * Idempotent: an absent id succeeds. A failing teardown is a removal-stage failure
   * (ADR 0006): recorded durably as lastRemovalAttempt before the error returns; the
   * record stays registered so the delete is retryable.
   */
  deleteWorkspace: fallible({
    input: deleteWorkspaceInputSchema,
    data: z.void(),
    error: deleteWorkspaceErrorSchema,
  }),

  /**
   * Deactivate (sessions + teardown) + force-remove the worktree artifact (+ branch when
   * asked) + unregister — one call that leaves nothing behind. Worktree records only.
   * No host-side dirty/unpushed refusals: informed confirmation is the client's job from
   * mirror observations; the host executes what it is told. Idempotent: an absent id
   * succeeds, which is what makes an external tombstone-and-reconcile sweep safe.
   * Failures (teardown included, as a removal stage) are recorded durably on the
   * record as lastRemovalAttempt — stage, host-decided class, message — before the
   * error returns; the return itself is loop control, never UI truth (ADR 0006).
   */
  deleteWorktree: fallible({
    input: deleteWorktreeInputSchema,
    data: z.void(),
    error: deleteWorktreeErrorSchema,
  }),

  /**
   * Explicit freshness verb: rescans one workspace (or the whole host), reconciling the
   * registry with the disk — adoption/un-adoption, missing flips, admin-name relinks —
   * and recomputing git observations. Results arrive through `records`.
   */
  refresh: fallible({
    input: refreshWorkspacesInputSchema,
    data: z.void(),
    error: workspaceNotFoundErrorSchema,
  }),
});

export type WorkspaceRegistryContract = typeof workspaceRegistryContract;
