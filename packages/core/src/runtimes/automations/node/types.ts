import type { Result } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import type {
  AutomationDeployment,
  AutomationId,
  AutomationRun,
  AutomationRunConfigSnapshot,
  AutomationRunError,
  AutomationRunId,
  AutomationRunStatus,
  AutomationRunTriggerKind,
  AutomationSchedule,
} from '@runtimes/automations/api';

/** Host bookkeeping wrapped around the deployed wire snapshot. */
export interface DeploymentRecord {
  deployment: AutomationDeployment;
  deployedAt: number;
  lastSeenAt: number;
}

export interface InsertScheduledRunInput {
  automationId: AutomationId;
  triggerKind: AutomationRunTriggerKind;
  scheduledAt: number;
  deadlineAt: number | null;
  configSnapshot: AutomationRunConfigSnapshot;
  generatedName: string;
}

/** Host artifacts recorded as a run progresses through execution. */
export type RunArtifacts = Partial<
  Pick<AutomationRun, 'worktree' | 'branchName' | 'conversationId' | 'sessionId'>
>;

/**
 * Guarded compare-and-set transition. Returns the updated run, or null when
 * the run is no longer in one of the `from` statuses (lost race, already
 * stopped, ...).
 */
export interface RunTransitionInput {
  runId: AutomationRunId;
  from: AutomationRunStatus | AutomationRunStatus[];
  to: AutomationRunStatus;
  at: number;
  error?: AutomationRunError | null;
  artifacts?: RunArtifacts;
}

/**
 * Durable host-side store (node:sqlite), single writer for deployments and
 * the runs journal. Every run mutation assigns a fresh monotonically
 * increasing `seq` so clients can catch up with one cursor per host.
 */
export interface AutomationsStore {
  upsertDeployment(record: DeploymentRecord): DeploymentRecord;
  getDeployment(automationId: AutomationId): DeploymentRecord | null;
  removeDeployment(automationId: AutomationId): boolean;
  listEnabledDeployments(): DeploymentRecord[];
  touchDeployment(automationId: AutomationId, lastSeenAt: number): void;

  /**
   * Insert a cron run with a dedup guard: at most one scheduled/queued cron
   * run per automation and scheduledAt. Returns null when the slot is taken.
   */
  insertScheduledRun(input: InsertScheduledRunInput): AutomationRun | null;
  insertManualRun(
    input: Omit<InsertScheduledRunInput, 'triggerKind' | 'deadlineAt'>
  ): AutomationRun;
  transitionRun(input: RunTransitionInput): AutomationRun | null;
  getRun(runId: AutomationRunId): AutomationRun | null;

  /** Queue drain + crash recovery. */
  markDueCronRunsQueued(now: number): AutomationRun[];
  listQueuedRuns(limit: number): Array<{ run: AutomationRun; deployment: DeploymentRecord }>;
  findRunsInStatuses(statuses: AutomationRunStatus[]): AutomationRun[];
  skipPendingCronRuns(automationId: AutomationId, code: string): AutomationRun[];
  enabledDeploymentsWithoutPendingCronRun(): DeploymentRecord[];

  /** Journal reads: seq > sinceSeq, filtered to the caller's automation ids. */
  listRunsSince(sinceSeq: number, automationIds: AutomationId[], limit: number): AutomationRun[];
}

/** Narrow slice of the workspace runtime the executor needs. */
export interface AutomationWorkspacePort {
  provisionWorktree(input: {
    repository: AutomationDeployment['repository'];
    git: Extract<AutomationDeployment['git'], { kind: 'create-branch' | 'use-branch' }>;
    /** Per-run name used for the worktree directory and created branch. */
    runName: string;
  }): Promise<
    Result<
      { worktree: NonNullable<AutomationRun['worktree']>; branchName: string },
      AutomationRunError
    >
  >;
  teardownWorktree(
    worktree: NonNullable<AutomationRun['worktree']>
  ): Promise<Result<void, AutomationRunError>>;
}

/** Narrow slice of the session runtime (ACP now, tui-agents later). */
export interface AutomationSessionPort {
  startSession(input: {
    conversationId: string;
    providerId: string;
    cwd: NonNullable<AutomationRun['worktree']>;
    model: string | null;
    prompt: string;
    autoApprove: boolean;
    title?: string;
  }): Promise<Result<{ sessionId: string }, AutomationRunError>>;
  stopSession(conversationId: string): Promise<void>;
}

export interface SchedulerConfig {
  tickMs: number;
  maxConcurrentRuns: number;
  /** Cap on how many due cron runs a single tick may enqueue. */
  maxDueEnqueue: number;
}

export interface AutomationsRuntimeDeps {
  store: AutomationsStore;
  workspace: AutomationWorkspacePort;
  sessions: AutomationSessionPort;
  /** Human-friendly per-run names for branches/worktrees/adopted tasks. */
  generateRunName: () => string;
  /** Cron evaluation (croner with timezone); injected for testability. */
  nextOccurrence: (schedule: AutomationSchedule, from: number) => number | null;
  now?: () => number;
  logger: Logger;
  scheduler: SchedulerConfig;
  /** Fed into the `runEvents` event stream host. */
  onRunChanged: (run: AutomationRun) => void;
}
