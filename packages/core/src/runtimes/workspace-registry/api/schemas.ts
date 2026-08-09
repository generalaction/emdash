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
 * fetch-branch | fetch-remote-base | create-worktree | configure-branch) settle in the
 * foreground pipeline; background-class steps (copy-artifacts | push-branch |
 * fetch-refs) run after the verb returns; script-class steps (prepare | setup | run |
 * teardown) track the current activation cycle.
 */
export const workspaceLifecycleStepIdSchema = z.enum([
  'adopt-worktree',
  'fetch-branch',
  'fetch-remote-base',
  'create-worktree',
  'configure-branch',
  'copy-artifacts',
  'push-branch',
  'fetch-refs',
  'prepare',
  'setup',
  'run',
  'teardown',
]);
export type WorkspaceLifecycleStepId = z.infer<typeof workspaceLifecycleStepIdSchema>;

/**
 * 'pending' and 'running' read as incomplete: background-class steps replay them
 * idempotently on host restart or the next activation; 'failed' is terminal and only
 * re-runs through the explicit retryStep verb — never automatically. 'skipped' marks
 * a step that was planned but became inapplicable at runtime; steps that never
 * applied to a record are absent, not skipped. 'cancelled' marks a run somebody
 * stopped (deactivation, the drawer's stop button) or a restart interrupted —
 * distinct from failed and from never-started.
 */
export const workspaceLifecycleStepStatusSchema = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'skipped',
  'cancelled',
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
 * The observed upstream identity, verbatim from `branch.<branch>.remote` and
 * `branch.<branch>.merge` config; `remoteUrl` from `git remote get-url`, null when the
 * remote does not resolve. Raw git facts — provider recognition is desktop-side.
 */
export const workspaceGitUpstreamSchema = z.object({
  remote: z.string(),
  mergeRef: z.string(),
  remoteUrl: z.string().nullable(),
});
export type WorkspaceGitUpstream = z.infer<typeof workspaceGitUpstreamSchema>;

/**
 * Host-computed git observations. `diffStats` includes untracked files' lines as
 * additions (respecting .gitignore); null = stats unavailable — a pathological worktree
 * degrades its own record, never the scan. The head OID, upstream identity, and PR
 * breadcrumb fields default to null so records from hosts predating them still parse
 * (wire-additive); each degrades to null independently on probe failure.
 */
export const workspaceGitObservationsSchema = z.object({
  branch: z.string().nullable(),
  dirty: z.boolean(),
  diffStats: z.object({ added: z.number(), deleted: z.number() }).nullable(),
  ahead: z.number().nullable(),
  behind: z.number().nullable(),
  locked: z.boolean(),
  prunable: z.boolean(),
  /** Full OID of HEAD; null on unborn HEAD or probe failure. */
  headOid: z.string().nullable().default(null),
  /** Null when detached, untracked, or the config probe failed. */
  upstream: workspaceGitUpstreamSchema.nullable().default(null),
  /** Raw value of `branch.<branch>.emdash-pr-url` config; never interpreted here. */
  prBreadcrumb: z.string().nullable().default(null),
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
 * Structured, host-validated git setup executed inside the foreground creation
 * pipeline (spec: pr-workspace-model provisioning). No raw refspecs or config keys
 * cross the contract: the host constructs the fetch destination from the verb's own
 * `branch` (a plain, never-force refspec guarded by a branch-exists check) and owns
 * the exact config keys the upstream and breadcrumb become.
 */
export const workspaceGitSetupSchema = z.object({
  /** Materialize the branch: fetch sourceRef from remote into refs/heads/<branch>. */
  fetchBranch: z.object({ remote: z.string().min(1), sourceRef: z.string().min(1) }).optional(),
  /** Upstream tracking, written as `branch.<branch>.remote` / `branch.<branch>.merge`. */
  upstream: z.object({ remote: z.string().min(1), mergeRef: z.string().min(1) }).optional(),
  /** PR breadcrumb, written as `branch.<branch>.emdash-pr-url`. */
  breadcrumb: z.object({ prUrl: z.string().min(1) }).optional(),
  /** Host-local ref-follow policy, recorded durably (consumed by the follow loop). */
  followRef: z.boolean().optional(),
});
export type WorkspaceGitSetup = z.infer<typeof workspaceGitSetupSchema>;

/**
 * Minimal immutable creation fields — what replay identity is enforced against and what
 * failure diagnosis needs. NOT rich provenance (that stays a desktop annotation). Null
 * for registered-existing and adopted records.
 */
export const workspaceCreationSchema = z.object({
  branch: z.string(),
  /** Null when gitSetup.fetchBranch materialized the branch instead of a base ref. */
  baseRef: z.string().nullable(),
  requestedPath: z.string(),
  /** The verb's gitSetup block, verbatim; the host's ref-follow loop reads it later. */
  gitSetup: workspaceGitSetupSchema.optional(),
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
  workspaceId: z.string().min(1),
  path: z.string().min(1),
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInputSchema>;

export const deleteWorkspaceInputSchema = z.object({
  workspaceId: z.string().min(1),
});
export type DeleteWorkspaceInput = z.infer<typeof deleteWorkspaceInputSchema>;

export const deleteWorktreeInputSchema = z.object({
  workspaceId: z.string().min(1),
  /** The branch is deletable independently of its worktree. */
  deleteBranch: z.boolean().default(false),
});
export type DeleteWorktreeInput = z.infer<typeof deleteWorktreeInputSchema>;

export const createWorktreeInputSchema = z
  .object({
    /** Desktop-minted UUID for the new worktree record. */
    workspaceId: z.string().min(1),
    /** The registered repository record to create from. */
    repositoryId: z.string().min(1),
    branch: z.string().min(1),
    /** Optional when gitSetup.fetchBranch materializes the branch instead. */
    baseRef: z.string().min(1).optional(),
    path: z.string().min(1),
    preservePatterns: z.array(z.string()).default([]),
    pushBranch: z.boolean().default(false),
    gitSetup: workspaceGitSetupSchema.optional(),
  })
  .superRefine((input, ctx) => {
    if (input.baseRef === undefined && input.gitSetup?.fetchBranch === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['baseRef'],
        message: 'baseRef is required unless gitSetup.fetchBranch materializes the branch',
      });
    }
  });
export type CreateWorktreeInput = z.infer<typeof createWorktreeInputSchema>;

/**
 * Fast-forward one worktree's checkout to `sourceRef` fetched from `remote` (spec:
 * pr-workspace-model staleness, manual update). Instruction-as-input: the host never
 * reads the durable record's `gitSetup` for this verb, which is what makes workspaces
 * created before the model shipped updatable with the exact same call.
 */
export const updateWorktreeInputSchema = z.object({
  workspaceId: z.string().min(1),
  remote: z.string().min(1),
  sourceRef: z.string().min(1),
});
export type UpdateWorktreeInput = z.infer<typeof updateWorktreeInputSchema>;

/**
 * Explicit "refresh now": rescans one workspace, or the whole host when workspaceId is
 * omitted.
 */
export const refreshWorkspacesInputSchema = z.object({
  workspaceId: z.string().min(1).optional(),
});
export type RefreshWorkspacesInput = z.infer<typeof refreshWorkspacesInputSchema>;

export const activateWorkspaceInputSchema = z.object({
  workspaceId: z.string().min(1),
});
export type ActivateWorkspaceInput = z.infer<typeof activateWorkspaceInputSchema>;

export const deactivateWorkspaceInputSchema = z.object({
  workspaceId: z.string().min(1),
});
export type DeactivateWorkspaceInput = z.infer<typeof deactivateWorkspaceInputSchema>;

/**
 * Keyed by workspace id (convention 5) — the registry resolves the path from its own
 * record; clients never hand it a path.
 */
export const measureUsageInputSchema = z.object({
  workspaceId: z.string().min(1),
});
export type MeasureUsageInput = z.infer<typeof measureUsageInputSchema>;

/** A non-fatal per-path measurement failure (unreadable directory, vanished file). */
export const workspaceUsageErrorSchema = z.object({
  path: z.string(),
  message: z.string(),
});
export type WorkspaceUsageError = z.infer<typeof workspaceUsageErrorSchema>;

/** The git-aware disk observation for one workspace. */
export const workspaceUsageSchema = z.object({
  /** Exclusive disk bytes for the workspace tree. */
  totalBytes: z.number().int().nonnegative(),
  /** Disk bytes attributable to git-ignored artifacts (reclaimable). */
  artifactBytes: z.number().int().nonnegative(),
  errors: z.array(workspaceUsageErrorSchema),
});
export type WorkspaceUsage = z.infer<typeof workspaceUsageSchema>;

/** The lifecycle steps a user may retry after a durable failure. */
export const retryableLifecycleStepSchema = z.enum(['copy-artifacts', 'push-branch']);
export type RetryableLifecycleStep = z.infer<typeof retryableLifecycleStepSchema>;

/**
 * Manual retry of a durably failed lifecycle step. Only failed retryable steps
 * re-run; anything else (succeeded, skipped, in-flight) is a no-op returning the
 * current record.
 */
export const retryStepInputSchema = z.object({
  workspaceId: z.string().min(1),
  step: retryableLifecycleStepSchema,
});
export type RetryStepInput = z.infer<typeof retryStepInputSchema>;
