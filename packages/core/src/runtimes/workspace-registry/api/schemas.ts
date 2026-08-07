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
 * Identity of one workspace lifecycle step. Creation-class steps (adopt-worktree |
 * fetch-remote-base | create-worktree) settle in the foreground pipeline; background-
 * class steps (copy-artifacts | push-branch | fetch-refs) run after the verb returns;
 * script-class steps (prepare | setup | run) track the current activation.
 */
export const workspaceLifecycleStepIdSchema = z.enum([
  'adopt-worktree',
  'fetch-remote-base',
  'create-worktree',
  'copy-artifacts',
  'push-branch',
  'fetch-refs',
  'prepare',
  'setup',
  'run',
]);
export type WorkspaceLifecycleStepId = z.infer<typeof workspaceLifecycleStepIdSchema>;

/**
 * 'pending' and 'running' read as incomplete: background-class steps replay them
 * idempotently on host restart or the next activation; 'failed' is terminal and only
 * re-runs through the explicit retryStep verb — never automatically. 'skipped' marks
 * a step that was planned but became inapplicable at runtime; steps that never
 * applied to a record are absent, not skipped.
 */
export const workspaceLifecycleStepStatusSchema = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'skipped',
]);
export type WorkspaceLifecycleStepStatus = z.infer<typeof workspaceLifecycleStepStatusSchema>;

/** Typed step params (branch, path, base, fileCount…); display copy is derived at render. */
export const workspaceLifecycleStepParamsSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()])
);
export type WorkspaceLifecycleStepParams = z.infer<typeof workspaceLifecycleStepParamsSchema>;

/**
 * One durable lifecycle step: machine facts only — titles, descriptions, and relative
 * dates are derived at render time, never persisted.
 */
export const workspaceLifecycleStepSchema = z.object({
  id: workspaceLifecycleStepIdSchema,
  status: workspaceLifecycleStepStatusSchema,
  /** Null until the step first runs (pending steps have not started). */
  startedAt: z.number().nullable(),
  /** Null until the step settles; long-lived run scripts may never settle. */
  finishedAt: z.number().nullable(),
  /** Present for failed steps (and skip reasons). */
  message: z.string().optional(),
  params: workspaceLifecycleStepParamsSchema,
});
export type WorkspaceLifecycleStep = z.infer<typeof workspaceLifecycleStepSchema>;

/**
 * The ordered durable lifecycle section: the single source of truth for what happened
 * to a workspace — it drives replay, gating, retry, AND the Activity timeline. Steps
 * appear in lifecycle order; conditional steps that never applied are absent.
 */
export const workspaceLifecycleSchema = z.object({
  steps: z.array(workspaceLifecycleStepSchema),
  /** Replay input for the copy-artifacts step; not part of the creation identity. */
  preservePatterns: z.array(z.string()),
});
export type WorkspaceLifecycle = z.infer<typeof workspaceLifecycleSchema>;

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
 * Non-fatal session-plane event (a failed lifecycle script, an unparseable
 * `.emdash.json`), carried on the runtime overlay — informational, never a verb
 * failure.
 */
export const workspaceNoticeSchema = z.union([
  z.object({
    id: z.string().min(1),
    kind: z.literal('script-failed'),
    script: z.enum(['prepare', 'setup', 'run', 'teardown']),
    message: z.string(),
    at: z.number(),
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal('config-invalid'),
    message: z.string(),
    at: z.number(),
  }),
]);
export type WorkspaceNotice = z.infer<typeof workspaceNoticeSchema>;

/**
 * The registry's config live model, projected per record: which scripts the
 * workspace's own `.emdash.json` defines and its preserve patterns — enough for the
 * desktop to render script availability without its own filesystem reads. Null until
 * the model's first read lands (boot and scans fill it off the blocking path).
 */
export const workspaceConfigSummarySchema = z.object({
  scripts: z.object({
    prepare: z.boolean(),
    setup: z.boolean(),
    run: z.boolean(),
    teardown: z.boolean(),
  }),
  preservePatterns: z.array(z.string()),
  /** True when the file exists but did not parse; the empty default applied. */
  parseError: z.boolean(),
});
export type WorkspaceConfigSummary = z.infer<typeof workspaceConfigSummarySchema>;

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
   * Lifecycle steps, projected from the durable lifecycle section on every publish
   * (unlike the rest of the overlay, they survive daemon restarts). While the
   * foreground creation pipeline runs, the in-flight stage rides along as a synthetic
   * running step so clients read one step surface.
   */
  lifecycle: z.array(workspaceLifecycleStepSchema).nullable().optional(),
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
  /** Durable lifecycle steps; null until creation or activation first writes one. */
  lifecycle: workspaceLifecycleSchema.nullable(),
  /** Null until a delete verb fails; removed with the record on success. */
  lastRemovalAttempt: workspaceRemovalAttemptSchema.nullable(),
  /** Null for plain directories (and until first observed). */
  git: workspaceGitObservationsSchema.nullable(),
  /** Observation only — never a durable "active" flag. */
  lastActivatedAt: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  /** Staleness is displayed, not hidden. */
  lastObservedAt: z.number(),
  /** The config live model's summary; null until the first read lands. */
  config: workspaceConfigSummarySchema.nullable(),
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

/** The lifecycle steps a user may retry after a durable failure. */
export const retryableLifecycleStepSchema = z.enum(['copy-artifacts', 'push-branch']);
export type RetryableLifecycleStep = z.infer<typeof retryableLifecycleStepSchema>;

/**
 * Manual retry of a durably failed lifecycle step. Only failed retryable steps
 * re-run; anything else (succeeded, skipped, in-flight) is a no-op returning the
 * current record.
 */
export const retryStepInputSchema = z.object({
  id: z.string().min(1),
  step: retryableLifecycleStepSchema,
});
export type RetryStepInput = z.infer<typeof retryStepInputSchema>;
