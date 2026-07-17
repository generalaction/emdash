import { randomUUID } from 'node:crypto';
import { ConcurrencyLimiter } from '@emdash/shared/concurrency';
import { noopLogger, type Logger } from '@emdash/shared/logger';
import { systemClock, type Clock, type TimerHandle } from '@emdash/shared/scheduling';
import {
  automationRunConfigSnapshotSchema,
  type AutomationDeployment,
  type AutomationId,
} from '../api/deployment';
import type { AutomationRun, AutomationRunId, AutomationRunStatus } from '../api/run';
import {
  IN_FLIGHT_RUN_STATUSES,
  type AutomationRunTransitions,
  type OnRunChanged,
} from './run-transitions';
import { nextRunTimes } from './utils/cron';

const DEFAULT_TICK_INTERVAL_MS = 60_000;
const DEFAULT_MAX_CONCURRENT_RUNS = 4;
const DEFAULT_MAX_DUE_PER_TICK = 100;

export interface AutomationSchedulerDeploymentStore {
  getDeployment(id: AutomationId): AutomationDeployment | null;
  listEnabledDeployments(): AutomationDeployment[];
}

export interface AutomationSchedulerRunStore {
  insertRun(run: Omit<AutomationRun, 'seq'>): AutomationRun | null;
  getRun(id: AutomationRunId): AutomationRun | null;
  getScheduledRun(automationId: AutomationId): AutomationRun | null;
  listDueScheduledRuns(now: number, limit: number): AutomationRun[];
  listQueuedRuns(limit: number): AutomationRun[];
  listRunsInStatuses(statuses: AutomationRunStatus[]): AutomationRun[];
}

export type AutomationRunIdentity = {
  id: AutomationRunId;
  generatedName: string;
};

export type AutomationRunExecutor = (run: AutomationRun, signal: AbortSignal) => Promise<void>;

export type AutomationSchedulerOptions = {
  deploymentStore: AutomationSchedulerDeploymentStore;
  runStore: AutomationSchedulerRunStore;
  transitions: AutomationRunTransitions;
  execute: AutomationRunExecutor;
  clock?: Clock;
  logger?: Logger;
  tickIntervalMs?: number;
  maxConcurrentRuns?: number;
  maxDuePerTick?: number;
  onRunChanged?: OnRunChanged;
  createRunIdentity?: (deployment: AutomationDeployment) => AutomationRunIdentity;
};

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer: ${value}`);
  }
  return value;
}

function defaultRunIdentity(): AutomationRunIdentity {
  const id = randomUUID();
  return { id, generatedName: `emdash-${id.slice(0, 8)}` };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Owns cron materialization and the bounded run queue.
 *
 * The scheduler only advances a run through the queue boundary. Once claimed
 * (`queued → provisioning_workspace`), the injected executor owns the
 * workspace/session workflow and its remaining transitions.
 */
export class AutomationScheduler {
  private readonly deploymentStore: AutomationSchedulerDeploymentStore;
  private readonly runStore: AutomationSchedulerRunStore;
  private readonly transitions: AutomationRunTransitions;
  private readonly execute: AutomationRunExecutor;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly tickIntervalMs: number;
  private readonly maxConcurrentRuns: number;
  private readonly maxDuePerTick: number;
  private readonly onRunChanged: OnRunChanged | undefined;
  private readonly createRunIdentity: (deployment: AutomationDeployment) => AutomationRunIdentity;
  private readonly limiter: ConcurrencyLimiter;
  private readonly signalController = new AbortController();
  private readonly workerRunIds = new Set<AutomationRunId>();
  private readonly activeAutomationIds = new Set<AutomationId>();
  private readonly workers = new Map<AutomationRunId, Promise<void>>();

  private timer: TimerHandle | undefined;
  private started = false;
  private startTask: Promise<void> | undefined;
  private tickTail: Promise<void> = Promise.resolve();
  private drainTail: Promise<void> = Promise.resolve();

  constructor(options: AutomationSchedulerOptions) {
    this.deploymentStore = options.deploymentStore;
    this.runStore = options.runStore;
    this.transitions = options.transitions;
    this.execute = options.execute;
    this.clock = options.clock ?? systemClock;
    this.logger = options.logger ?? noopLogger;
    this.tickIntervalMs = positiveInteger(
      options.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS,
      'Automation scheduler tick interval'
    );
    this.maxConcurrentRuns = positiveInteger(
      options.maxConcurrentRuns ?? DEFAULT_MAX_CONCURRENT_RUNS,
      'Automation scheduler concurrency'
    );
    this.maxDuePerTick = positiveInteger(
      options.maxDuePerTick ?? DEFAULT_MAX_DUE_PER_TICK,
      'Automation scheduler due-run limit'
    );
    this.onRunChanged = options.onRunChanged;
    this.createRunIdentity = options.createRunIdentity ?? defaultRunIdentity;
    this.limiter = new ConcurrencyLimiter(this.maxConcurrentRuns);
  }

  /**
   * Recovers interrupted workers, reconciles cron state, drains queued work,
   * and starts the recurring tick. Concurrent calls share one bootstrap.
   */
  start(): Promise<void> {
    if (this.startTask) return this.startTask;
    this.started = true;
    this.startTask = (async () => {
      await this.recoverInterruptedRuns();
      await this.tick();
      if (this.started) this.scheduleNextTick();
    })().catch((error: unknown) => {
      this.started = false;
      this.startTask = undefined;
      throw error;
    });
    return this.startTask;
  }

  /** Stops future ticks. Already-running workflows are allowed to finish. */
  stop(): void {
    this.started = false;
    this.timer?.dispose();
    this.timer = undefined;
    this.startTask = undefined;
  }

  /** Reconciles cron state and drains the queue without changing timer state. */
  reload(): Promise<void> {
    return this.tick();
  }

  /**
   * Creates a manual queued run from an already-validated deployment snapshot
   * and asks the queue to drain immediately.
   */
  runNow(deployment: AutomationDeployment): AutomationRun {
    const run = this.insertRun(deployment, {
      status: 'queued',
      triggerKind: 'manual',
      scheduledAt: null,
      deadlineAt: null,
    });
    if (!run) {
      throw new Error(`Failed to insert manual automation run for ${deployment.automationId}`);
    }
    this.drainInBackground();
    return run;
  }

  /**
   * Test/lifecycle barrier: resolves once all currently queued scheduler work
   * and run executors have settled, including drains triggered by completion.
   */
  async idle(): Promise<void> {
    for (;;) {
      await this.tickTail;
      await this.drainTail;
      const workers = [...this.workers.values()];
      if (workers.length === 0) {
        await this.drainTail;
        if (this.workers.size === 0) return;
        continue;
      }
      await Promise.allSettled(workers);
    }
  }

  private scheduleNextTick(): void {
    this.timer?.dispose();
    this.timer = this.clock.schedule(
      this.tickIntervalMs,
      () => {
        this.timer = undefined;
        void this.tick()
          .catch((error: unknown) => {
            this.logger.error('Automation scheduler tick failed', {
              error: errorMessage(error),
            });
          })
          .finally(() => {
            if (this.started) this.scheduleNextTick();
          });
      },
      { unref: true }
    );
  }

  private tick(): Promise<void> {
    const task = this.tickTail.then(() => this.performTick());
    this.tickTail = task.catch(() => {});
    return task;
  }

  private async performTick(): Promise<void> {
    const now = this.clock.now();
    this.ensureScheduledRuns(now);

    const dueRuns = this.runStore.listDueScheduledRuns(now, this.maxDuePerTick);
    for (const due of dueRuns) {
      const deployment = this.deploymentStore.getDeployment(due.automationId);
      if (!deployment) {
        this.transitions.markSkipped(due.id, { step: 'queue', code: 'automation_deleted' }, now);
        continue;
      }
      if (!deployment.enabled) {
        this.transitions.markSkipped(due.id, { step: 'queue', code: 'automation_disabled' }, now);
        continue;
      }

      const queued = this.transitions.markQueued(due.id);
      if (queued) this.ensureScheduledRun(deployment, now);
    }

    await this.drainQueue();
  }

  private ensureScheduledRuns(now: number): void {
    for (const deployment of this.deploymentStore.listEnabledDeployments()) {
      this.ensureScheduledRun(deployment, now);
    }
  }

  private ensureScheduledRun(deployment: AutomationDeployment, now: number): AutomationRun | null {
    const existing = this.runStore.getScheduledRun(deployment.automationId);
    if (existing) return existing;

    const times = nextRunTimes(deployment.schedule, now);
    if (!times) return null;
    return this.insertRun(deployment, {
      status: 'scheduled',
      triggerKind: 'cron',
      scheduledAt: times.scheduledAt,
      deadlineAt: times.deadlineAt,
    });
  }

  private insertRun(
    deployment: AutomationDeployment,
    values: Pick<AutomationRun, 'status' | 'triggerKind' | 'scheduledAt' | 'deadlineAt'>
  ): AutomationRun | null {
    const identity = this.createRunIdentity(deployment);
    const run = this.runStore.insertRun({
      ...identity,
      automationId: deployment.automationId,
      ...values,
      configSnapshot: automationRunConfigSnapshotSchema.parse(deployment),
      startedAt: null,
      finishedAt: null,
      worktree: null,
      branchName: null,
      conversationId: null,
      sessionId: null,
      error: null,
    });
    if (run) this.onRunChanged?.(run);
    return run;
  }

  private drainQueue(): Promise<void> {
    const task = this.drainTail.then(() => this.pumpQueue());
    this.drainTail = task.catch(() => {});
    return task;
  }

  private drainInBackground(): void {
    void this.drainQueue().catch((error: unknown) => {
      this.logger.error('Automation scheduler queue drain failed', {
        error: errorMessage(error),
      });
    });
  }

  private async pumpQueue(): Promise<void> {
    for (;;) {
      const capacity = this.maxConcurrentRuns - this.workerRunIds.size;
      if (capacity <= 0) return;

      const queuedRuns = this.runStore.listQueuedRuns(capacity);
      if (queuedRuns.length === 0) return;

      let madeProgress = false;
      for (const run of queuedRuns) {
        if (this.workerRunIds.size >= this.maxConcurrentRuns) return;
        if (this.workerRunIds.has(run.id)) continue;

        const now = this.clock.now();
        if (run.deadlineAt !== null && run.deadlineAt <= now) {
          this.transitions.markSkipped(run.id, { step: 'queue', code: 'deadline_exceeded' }, now);
          madeProgress = true;
          continue;
        }

        const deployment = this.deploymentStore.getDeployment(run.automationId);
        if (!deployment) {
          this.transitions.markSkipped(run.id, { step: 'queue', code: 'automation_deleted' }, now);
          madeProgress = true;
          continue;
        }
        if (!deployment.enabled) {
          this.transitions.markSkipped(run.id, { step: 'queue', code: 'automation_disabled' }, now);
          madeProgress = true;
          continue;
        }
        if (this.activeAutomationIds.has(run.automationId)) {
          this.transitions.markSkipped(run.id, { step: 'queue', code: 'previous_running' }, now);
          madeProgress = true;
          continue;
        }

        const claimed = this.transitions.claimQueued(run.id, now);
        if (!claimed) continue;
        madeProgress = true;
        this.startWorker(claimed);
      }

      if (!madeProgress) return;
    }
  }

  private startWorker(run: AutomationRun): void {
    this.workerRunIds.add(run.id);
    this.activeAutomationIds.add(run.automationId);

    const worker = this.limiter
      .run(this.signalController.signal, () => this.execute(run, this.signalController.signal))
      .catch((error: unknown) => {
        this.logger.error('Automation run executor failed', {
          automationId: run.automationId,
          runId: run.id,
          error: errorMessage(error),
        });
        this.transitions.markFailed(
          run.id,
          { step: 'run', code: 'unknown', message: errorMessage(error) },
          this.clock.now()
        );
      })
      .finally(() => {
        this.workerRunIds.delete(run.id);
        this.activeAutomationIds.delete(run.automationId);
        this.workers.delete(run.id);
        this.drainInBackground();
      });
    this.workers.set(run.id, worker);
  }

  private async recoverInterruptedRuns(): Promise<void> {
    const stuckRuns = this.runStore.listRunsInStatuses([...IN_FLIGHT_RUN_STATUSES]);
    const now = this.clock.now();
    for (const run of stuckRuns) this.transitions.markInterrupted(run, now);
  }
}
