import { randomUUID } from 'node:crypto';
import { noopLogger, type Logger } from '@emdash/shared/logger';
import { systemClock, type Clock, type TimerHandle } from '@emdash/shared/scheduling';
import {
  automationRunConfigSnapshotSchema,
  type AutomationDeployment,
  type AutomationId,
} from '../api/deployment';
import type { AutomationRun, AutomationRunId } from '../api/run';
import type { AutomationRunExecutor } from './run-executor';
import type { AutomationRunTransitions, OnRunChanged } from './run-transitions';
import type { AutomationDeploymentStore } from './storage/deployment-store';
import type { AutomationRunStore } from './storage/run-store';
import { nextRunTimes } from './utils/cron';

const DEFAULT_TICK_INTERVAL_MS = 60_000;
const DEFAULT_MAX_CONCURRENT_RUNS = 4;
const DEFAULT_MAX_DUE_PER_TICK = 100;

export type AutomationRunIdentity = {
  id: AutomationRunId;
  generatedName: string;
};

export type AutomationSchedulerOptions = {
  deploymentStore: AutomationDeploymentStore;
  runStore: AutomationRunStore;
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

type ActiveWorker = {
  automationId: AutomationId;
  abortController: AbortController;
  done: Promise<void>;
};

export class AutomationScheduler {
  private readonly deploymentStore: AutomationDeploymentStore;
  private readonly runStore: AutomationRunStore;
  private readonly transitions: AutomationRunTransitions;
  private readonly execute: AutomationRunExecutor;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly tickIntervalMs: number;
  private readonly maxConcurrentRuns: number;
  private readonly maxDuePerTick: number;
  private readonly onRunChanged: OnRunChanged | undefined;
  private readonly createRunIdentity: (deployment: AutomationDeployment) => AutomationRunIdentity;

  private readonly workers = new Map<AutomationRunId, ActiveWorker>();

  private timer: TimerHandle | undefined;
  private started = false;

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
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    try {
      this.recoverInterruptedRuns();
      this.reconcile();
    } catch (error) {
      this.started = false;
      throw error;
    }
    this.scheduleNextTick();
  }

  async stop(): Promise<void> {
    this.started = false;
    this.timer?.dispose();
    this.timer = undefined;

    const workers = [...this.workers.values()];
    for (const worker of workers) worker.abortController.abort();
    await Promise.allSettled(workers.map((worker) => worker.done));
  }

  reconcile(): void {
    const now = this.clock.now();
    this.reconcilePendingRuns(now);
    this.queueDueRuns(now);
    this.ensureScheduledRuns(now);
    this.drainQueue();
  }

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
    this.drainQueue();
    return this.runStore.getRun(run.id) ?? run;
  }

  cancelRun(runId: AutomationRunId): AutomationRun | null {
    const run = this.runStore.getRun(runId);
    if (!run) return null;

    const cancelled =
      run.status === 'scheduled'
        ? this.transitions.markSkipped(
            runId,
            { step: 'queue', code: 'cancelled' },
            this.clock.now()
          )
        : this.transitions.markCancelled(runId, this.clock.now());
    if (!cancelled) return run;

    this.workers.get(runId)?.abortController.abort();
    return cancelled;
  }

  async idle(): Promise<void> {
    while (this.workers.size > 0) {
      await Promise.allSettled([...this.workers.values()].map((worker) => worker.done));
    }
  }

  private recoverInterruptedRuns(): void {
    const stuckRuns = this.runStore.listRunsInStatuses([
      'provisioning_workspace',
      'starting_session',
    ]);
    const now = this.clock.now();
    for (const run of stuckRuns) this.transitions.markInterrupted(run, now);
  }

  private scheduleNextTick(): void {
    this.timer?.dispose();
    this.timer = this.clock.schedule(
      this.tickIntervalMs,
      () => {
        this.timer = undefined;
        if (!this.started) return;
        try {
          this.reconcile();
        } catch (error: unknown) {
          this.logger.error('Automation scheduler tick failed', {
            error: errorMessage(error),
          });
        }
        if (this.started) this.scheduleNextTick();
      },
      { unref: true }
    );
  }

  private reconcilePendingRuns(now: number): void {
    for (const run of this.runStore.listRunsInStatuses(['scheduled', 'queued'])) {
      const deployment = this.deploymentStore.getDeployment(run.automationId);
      if (!deployment) {
        this.transitions.markSkipped(run.id, { step: 'queue', code: 'automation_deleted' }, now);
        continue;
      }
      if (!deployment.enabled) {
        this.transitions.markSkipped(run.id, { step: 'queue', code: 'automation_disabled' }, now);
        continue;
      }
      if (run.status !== 'scheduled') continue;

      const scheduleChanged =
        run.configSnapshot.schedule.expr !== deployment.schedule.expr ||
        run.configSnapshot.schedule.tz !== deployment.schedule.tz;
      if (scheduleChanged) {
        this.transitions.markSkipped(run.id, { step: 'queue', code: 'redeployed' }, now);
      }
    }
  }

  private queueDueRuns(now: number): void {
    for (const due of this.runStore.listDueScheduledRuns(now, this.maxDuePerTick)) {
      this.transitions.markQueued(due.id);
    }
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
      workspace: null,
      branchName: null,
      conversationId: null,
      sessionId: null,
      error: null,
    });
    if (run) this.onRunChanged?.(run);
    return run;
  }

  private drainQueue(): void {
    for (;;) {
      const capacity = this.maxConcurrentRuns - this.workers.size;
      if (capacity <= 0) return;

      const queuedRuns = this.runStore.listQueuedRuns(capacity);
      if (queuedRuns.length === 0) return;

      let madeProgress = false;
      for (const run of queuedRuns) {
        if (this.workers.size >= this.maxConcurrentRuns) return;

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
        if (this.isAutomationActive(run.automationId)) {
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

  private isAutomationActive(automationId: AutomationId): boolean {
    for (const worker of this.workers.values()) {
      if (worker.automationId === automationId) return true;
    }
    return false;
  }

  private startWorker(run: AutomationRun): void {
    const abortController = new AbortController();

    const done = Promise.resolve()
      .then(() => this.execute(run, abortController.signal))
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
        this.workers.delete(run.id);
        if (!this.started) return;
        try {
          this.drainQueue();
        } catch (error: unknown) {
          this.logger.error('Automation scheduler queue drain failed', {
            error: errorMessage(error),
          });
        }
      });

    this.workers.set(run.id, {
      automationId: run.automationId,
      abortController,
      done,
    });
  }
}

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
