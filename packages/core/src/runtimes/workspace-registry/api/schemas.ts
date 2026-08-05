import { z } from 'zod';

/** Host-detected at registration, never client-supplied (ADR 0005). */
export const workspaceKindSchema = z.enum(['repository', 'worktree', 'directory']);
export type WorkspaceKind = z.infer<typeof workspaceKindSchema>;

/** Explicit registration vs host-discovered worktree of a registered repository. */
export const workspaceOriginSchema = z.enum(['registered', 'adopted']);
export type WorkspaceOrigin = z.infer<typeof workspaceOriginSchema>;

/**
 * Registered records survive a vanished path as 'missing'; adopted records are deleted
 * instead, so 'missing' is effectively registered-only.
 */
export const workspaceObservedStatusSchema = z.enum(['present', 'missing']);
export type WorkspaceObservedStatus = z.infer<typeof workspaceObservedStatusSchema>;

/**
 * Durable outcome of the last createWorktree attempt (precedent: conversations'
 * lastResumeOutcome). 'started' + no runtime overlay = interrupted; resolved only by a
 * client replay, never host-initiated — outcomes are facts, not desired state.
 */
export const workspaceCreateOutcomeSchema = z.union([
  z.object({ status: z.literal('started'), at: z.number() }),
  z.object({ status: z.literal('succeeded'), at: z.number() }),
  z.object({
    status: z.literal('failed'),
    at: z.number(),
    stage: z.string(),
    message: z.string(),
  }),
]);
export type WorkspaceCreateOutcome = z.infer<typeof workspaceCreateOutcomeSchema>;

/**
 * Host-computed git observations. `diffStats` includes untracked files' lines as
 * additions (respecting .gitignore); null = stats unavailable — a pathological worktree
 * degrades its own record, never the scan.
 */
export const workspaceGitObservationsSchema = z.object({
  branch: z.string().nullable(),
  dirty: z.boolean(),
  diffStats: z.object({ added: z.number(), deleted: z.number() }).nullable(),
  ahead: z.number().nullable(),
  behind: z.number().nullable(),
  locked: z.boolean(),
  prunable: z.boolean(),
});
export type WorkspaceGitObservations = z.infer<typeof workspaceGitObservationsSchema>;

/**
 * Non-fatal session-plane event (a failed lifecycle script), carried on the runtime
 * overlay — informational with a re-run affordance, never a verb failure.
 */
export const workspaceNoticeSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('script-failed'),
  script: z.enum(['prepare', 'setup', 'run', 'teardown']),
  message: z.string(),
  at: z.number(),
});
export type WorkspaceNotice = z.infer<typeof workspaceNoticeSchema>;

/**
 * In-memory host state merged into `records` when publishing; absent after a daemon
 * restart — activation is ephemeral by design. The ONLY progress surface: no job
 * objects on this contract.
 */
export const workspaceRuntimeOverlaySchema = z.object({
  /** Present while a createWorktree run is executing. */
  creation: z.object({ stage: z.string(), startedAt: z.number() }).nullable(),
  notices: z.array(workspaceNoticeSchema),
  /**
   * Prepare gates sessions; setup runs after activation concurrent with sessions; run
   * waits on setup success. Script failures surface as notices, never fail activation.
   */
  activation: z
    .object({
      phase: z.enum(['preparing', 'active']),
      scripts: z.object({
        prepare: z.enum(['running', 'succeeded', 'failed', 'skipped']),
        setup: z.enum(['pending', 'running', 'succeeded', 'failed', 'skipped']),
        run: z.enum(['pending', 'running', 'exited', 'failed', 'skipped']),
      }),
      activatedAt: z.number().nullable(),
    })
    .nullable(),
});
export type WorkspaceRuntimeOverlay = z.infer<typeof workspaceRuntimeOverlaySchema>;

/**
 * Minimal immutable creation fields — what replay identity is enforced against and what
 * failure diagnosis needs. NOT rich provenance (that stays a desktop annotation). Null
 * for registered-existing and adopted records.
 */
export const workspaceCreationSchema = z.object({
  branch: z.string(),
  baseRef: z.string(),
  requestedPath: z.string(),
});
export type WorkspaceCreation = z.infer<typeof workspaceCreationSchema>;

/** One host workspace record. All timestamps are epoch-ms. */
export const workspaceRecordSchema = z.object({
  /** UUID; desktop-minted on create verbs, host-minted on adoption. Never changes. */
  id: z.string().min(1),
  kind: workspaceKindSchema,
  /** Mutable, unique among live records per host; moves relink by git admin name. */
  path: z.string().min(1),
  /** Worktree → its repository's record id. Null for repository/directory. */
  parentId: z.string().nullable(),
  origin: workspaceOriginSchema,
  /** Git worktree admin name; the relink anchor for moved worktrees. */
  gitAdminName: z.string().nullable(),
  observedStatus: workspaceObservedStatusSchema,
  creation: workspaceCreationSchema.nullable(),
  /** Null unless this record was born from createWorktree. */
  lastCreateOutcome: workspaceCreateOutcomeSchema.nullable(),
  /** Null for plain directories (and until first observed). */
  git: workspaceGitObservationsSchema.nullable(),
  /** Observation only — never a durable "active" flag. */
  lastActivatedAt: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  /** Staleness is displayed, not hidden. */
  lastObservedAt: z.number(),
  /** In-memory overlay; null when nothing is running (or after a daemon restart). */
  runtime: workspaceRuntimeOverlaySchema.nullable(),
});
export type WorkspaceRecord = z.infer<typeof workspaceRecordSchema>;

export const workspaceRecordsSchema = z.record(z.string(), workspaceRecordSchema);
export type WorkspaceRecords = z.infer<typeof workspaceRecordsSchema>;

export const createWorkspaceInputSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInputSchema>;

export const deleteWorkspaceInputSchema = z.object({
  id: z.string().min(1),
});
export type DeleteWorkspaceInput = z.infer<typeof deleteWorkspaceInputSchema>;

/** Explicit "refresh now": rescans one workspace, or the whole host when id is omitted. */
export const refreshWorkspacesInputSchema = z.object({
  id: z.string().min(1).optional(),
});
export type RefreshWorkspacesInput = z.infer<typeof refreshWorkspacesInputSchema>;
