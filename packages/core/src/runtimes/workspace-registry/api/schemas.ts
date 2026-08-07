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
 * Durable trace of the last failed removal attempt (ADR 0006): written by the delete
 * verbs before they return a failure; removed with the record on success — no explicit
 * clear. `stage` names the removal step that failed ('teardown' | 'remove' |
 * 'unregister'); `class` is host-decided — 'transient' failures ride silent sweep
 * retries, 'terminal' ones stop auto-retry and need user attention. The client never
 * classifies.
 */
export const workspaceRemovalAttemptSchema = z.object({
  stage: z.string(),
  class: z.enum(['transient', 'terminal']),
  message: z.string(),
  at: z.number(),
});
export type WorkspaceRemovalAttempt = z.infer<typeof workspaceRemovalAttemptSchema>;

/**
 * Durable last outcome of one lifecycle script run, overwrite-in-place (the
 * conversations lastResumeOutcome precedent). Written where the script runner
 * publishes notices today; unlike notices it survives daemon restarts and keeps
 * success stamps. `message` is present for non-success outcomes.
 */
export const workspaceScriptOutcomeSchema = z.object({
  outcome: z.enum(['succeeded', 'failed', 'timed-out']),
  at: z.number(),
  message: z.string().optional(),
});
export type WorkspaceScriptOutcome = z.infer<typeof workspaceScriptOutcomeSchema>;

/** Per-script last outcomes; null per script until that script has settled once. */
export const workspaceScriptOutcomesSchema = z.object({
  prepare: workspaceScriptOutcomeSchema.nullable(),
  setup: workspaceScriptOutcomeSchema.nullable(),
  run: workspaceScriptOutcomeSchema.nullable(),
});
export type WorkspaceScriptOutcomes = z.infer<typeof workspaceScriptOutcomesSchema>;

/**
 * Durable status of one background creation step. 'pending' and 'running' read as
 * incomplete and replay idempotently on host restart or the next activation; 'failed'
 * is terminal and only re-runs through an explicit retry verb (push) — never
 * automatically. 'skipped' marks a step that does not apply to this record.
 */
export const workspaceBackgroundStepSchema = z.object({
  status: z.enum(['pending', 'running', 'succeeded', 'failed', 'skipped']),
  at: z.number(),
  /** Present for failed steps. */
  message: z.string().optional(),
});
export type WorkspaceBackgroundStep = z.infer<typeof workspaceBackgroundStepSchema>;

/** Per-step statuses of the background half of createWorktree. Null per step = never requested. */
export const workspaceBackgroundStepsSchema = z.object({
  cloneArtifacts: workspaceBackgroundStepSchema.nullable(),
  pushBranch: workspaceBackgroundStepSchema.nullable(),
  fetchRefs: workspaceBackgroundStepSchema.nullable(),
});
export type WorkspaceBackgroundSteps = z.infer<typeof workspaceBackgroundStepsSchema>;

/**
 * The durable background section of a creation record: step statuses plus the replay
 * inputs that are not part of the immutable creation identity. Written when the
 * worktree creation registers; steps advance as the background half executes.
 */
export const workspaceBackgroundSchema = z.object({
  steps: workspaceBackgroundStepsSchema,
  /** Honored-but-deprecated preserve patterns, kept for background replay. */
  preservePatterns: z.array(z.string()),
});
export type WorkspaceBackground = z.infer<typeof workspaceBackgroundSchema>;

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
   * Background creation-step statuses, projected from the durable background section
   * on every publish (unlike the rest of the overlay, this survives daemon restarts).
   */
  background: workspaceBackgroundStepsSchema.nullable().optional(),
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
  /** Durable background creation steps; null unless born from createWorktree. */
  background: workspaceBackgroundSchema.nullable(),
  /** Null until a delete verb fails; removed with the record on success. */
  lastRemovalAttempt: workspaceRemovalAttemptSchema.nullable(),
  /** Null until any lifecycle script has settled once. */
  scriptOutcomes: workspaceScriptOutcomesSchema.nullable(),
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

export const deleteWorktreeInputSchema = z.object({
  id: z.string().min(1),
  /** The branch is deletable independently of its worktree. */
  deleteBranch: z.boolean().default(false),
});
export type DeleteWorktreeInput = z.infer<typeof deleteWorktreeInputSchema>;

export const createWorktreeInputSchema = z.object({
  /** Desktop-minted UUID for the new worktree record. */
  id: z.string().min(1),
  /** The registered repository record to create from. */
  repositoryId: z.string().min(1),
  branch: z.string().min(1),
  baseRef: z.string().min(1),
  path: z.string().min(1),
  preservePatterns: z.array(z.string()).default([]),
  pushBranch: z.boolean().default(false),
});
export type CreateWorktreeInput = z.infer<typeof createWorktreeInputSchema>;

/** Explicit "refresh now": rescans one workspace, or the whole host when id is omitted. */
export const refreshWorkspacesInputSchema = z.object({
  id: z.string().min(1).optional(),
});
export type RefreshWorkspacesInput = z.infer<typeof refreshWorkspacesInputSchema>;

export const activateWorkspaceInputSchema = z.object({
  id: z.string().min(1),
});
export type ActivateWorkspaceInput = z.infer<typeof activateWorkspaceInputSchema>;

export const deactivateWorkspaceInputSchema = z.object({
  id: z.string().min(1),
});
export type DeactivateWorkspaceInput = z.infer<typeof deactivateWorkspaceInputSchema>;

/** Manual retry of a failed background branch push (the only user-retryable step). */
export const retryPushBranchInputSchema = z.object({
  id: z.string().min(1),
});
export type RetryPushBranchInput = z.infer<typeof retryPushBranchInputSchema>;
