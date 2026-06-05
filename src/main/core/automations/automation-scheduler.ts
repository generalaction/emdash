import { log } from '@main/lib/logger';
import type { Automation } from '@shared/automations/automation';
import type { AutomationRun } from '@shared/automations/automation-run';
import {
  automationRunDeadline,
  enabledAutomationsWithoutQueuedRun,
  ensureNextCronRun,
  findRunsStuckInCreatingConversation,
  findRunsStuckInCreatingTask,
  findRunsStuckInLaunchingTask,
  listQueuedRuns,
  markDueCronRunsQueued,
  startCreatingTask,
} from './repo';
import { markRunFailed, markRunSkipped, type OnStepCompleted } from './run-transitions';
import { runQueuedAutomation, type AutomationRunExecutor } from './runtime';

export { automationRunDeadline };

const TICK_MS = 60_000;
const MAX_DUE_ENQUEUE = 100;
// Each run may allocate a worktree, PTY and agent process; keep local fan-out conservative.
const MAX_CONCURRENT_RUNS = 4;

class SlotPool {
  private activeCount = 0;

  constructor(
    private readonly limit: number,
    private readonly onSlotFreed: () => void
  ) {}

  get availableSlots(): number {
    return Math.max(0, this.limit - this.activeCount);
  }

  start(task: () => Promise<void>): boolean {
    if (this.availableSlots <= 0) return false;
    this.activeCount += 1;
    void task().finally(() => {
      this.activeCount -= 1;
      this.onSlotFreed();
    });
    return true;
  }
}

export class AutomationScheduler {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private drainTail: Promise<void> = Promise.resolve();
  private bootstrapTail: Promise<void> = Promise.resolve();
  private readonly inFlight = new Set<string>(); // automation IDs currently executing
  private readonly slotPool = new SlotPool(MAX_CONCURRENT_RUNS, () => {
    void this.drainQueue();
  });

  constructor(
    private readonly executor: AutomationRunExecutor = runQueuedAutomation,
    // Non-readonly so start() can wire the real automationsService callback via lazy import.
    // Tests inject a spy directly via this constructor param.
    private onRunStep: OnStepCompleted = () => {}
  ) {}

  start(): void {
    if (this.timer) return;

    // Lazy import to avoid circular dependency at module load time.
    // automationsService → scheduler, so scheduler must not import automationsService at top level.
    void import('./automations-service').then(({ automationsService }) => {
      this.onRunStep = (run) => automationsService.notifyRunStep(run);
      automationsService.on('automation:created', () => void this.reload());
      automationsService.on('automation:enabled', () => void this.reload());
      automationsService.on('automation:updated', () => void this.reload());
    });

    this.recoverInterruptedRuns().catch((error) => {
      log.error('AutomationScheduler recovery failed', { error: String(error) });
    });
    this.reload().catch((error) => {
      log.error('AutomationScheduler bootstrap failed', { error: String(error) });
    });
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async reload(): Promise<void> {
    const run = this.bootstrapTail.then(() => this.bootstrapDueRuns());
    this.bootstrapTail = run.catch((error) => {
      log.error('AutomationScheduler bootstrap failed', { error: String(error) });
    });
    await this.bootstrapTail;
  }

  /** Mark all stuck in-progress runs as interrupted so they don't get stuck forever. */
  private async recoverInterruptedRuns(): Promise<void> {
    const now = Date.now();

    const stuckCreating = await findRunsStuckInCreatingTask();
    for (const { id } of stuckCreating) {
      const failed = await markRunFailed(
        id,
        { step: 'create_task', code: 'interrupted_by_restart' },
        now
      );
      this.onRunStep(failed);
    }
    if (stuckCreating.length > 0) {
      log.warn('AutomationScheduler recovered stuck creating_task runs', {
        count: stuckCreating.length,
      });
    }

    const stuckLaunching = await findRunsStuckInLaunchingTask();
    for (const { id } of stuckLaunching) {
      const failed = await markRunFailed(
        id,
        { step: 'launch_task', code: 'interrupted_by_restart' },
        now
      );
      this.onRunStep(failed);
    }
    if (stuckLaunching.length > 0) {
      log.warn('AutomationScheduler recovered stuck launching_task runs', {
        count: stuckLaunching.length,
      });
    }

    const stuckConversation = await findRunsStuckInCreatingConversation();
    for (const { id } of stuckConversation) {
      const failed = await markRunFailed(
        id,
        { step: 'create_conversation', code: 'interrupted_by_restart' },
        now
      );
      this.onRunStep(failed);
    }
    if (stuckConversation.length > 0) {
      log.warn('AutomationScheduler recovered stuck creating_conversation runs', {
        count: stuckConversation.length,
      });
    }
  }

  private async bootstrapDueRuns(): Promise<void> {
    const now = Date.now();

    // Ensure every enabled automation has a scheduled cron run (self-healing).
    const needsScheduled = await enabledAutomationsWithoutQueuedRun();
    await Promise.allSettled(
      needsScheduled.map(async (automation) => {
        try {
          await ensureNextCronRun(automation, now);
        } catch (error) {
          log.error('AutomationScheduler failed to ensure next cron run on bootstrap', {
            automationId: automation.id,
            error: String(error),
          });
        }
      })
    );

    // Transition any due scheduled cron runs to queued.
    const transitioned = await markDueCronRunsQueued(now);
    for (const { automation } of transitioned.slice(0, MAX_DUE_ENQUEUE)) {
      await ensureNextCronRun(automation, now).catch((error) => {
        log.error('AutomationScheduler failed to schedule next cron run after transition', {
          automationId: automation.id,
          error: String(error),
        });
      });
    }

    await this.drainQueue();
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = Date.now();

      // Phase 1: transition due scheduled runs → queued and pre-schedule next occurrences.
      const transitioned = await markDueCronRunsQueued(now);
      for (const { automation } of transitioned.slice(0, MAX_DUE_ENQUEUE)) {
        await ensureNextCronRun(automation, now).catch((error) => {
          log.error('AutomationScheduler failed to schedule next cron run', {
            automationId: automation.id,
            error: String(error),
          });
        });
      }

      // Phase 2: drain the queue.
      await this.drainQueue();
    } catch (error) {
      log.error('AutomationScheduler tick failed', { error: String(error) });
    } finally {
      this.ticking = false;
    }
  }

  async drainQueue(): Promise<void> {
    const run = this.drainTail.then(() => this.pumpQueue());
    this.drainTail = run.catch((error) => {
      log.error('AutomationScheduler queue drain failed', { error: String(error) });
    });
    await this.drainTail;
  }

  private async pumpQueue(): Promise<void> {
    while (this.slotPool.availableSlots > 0) {
      const capacity = this.slotPool.availableSlots;
      const batch = await listQueuedRuns(capacity);
      if (batch.length === 0) return;

      let madeProgress = false;
      for (const entry of batch) {
        if (this.slotPool.availableSlots <= 0) return;

        if (entry.run.deadlineAt != null && entry.run.deadlineAt <= Date.now()) {
          const skipped = await markRunSkipped(entry.run.id, {
            step: 'queue',
            code: 'deadline_exceeded',
          });
          this.onRunStep(skipped);
          madeProgress = true;
          continue;
        }

        if (entry.automation.projectId == null) {
          const skipped = await markRunSkipped(entry.run.id, { step: 'queue', code: 'no_project' });
          this.onRunStep(skipped);
          madeProgress = true;
          continue;
        }

        if (this.inFlight.has(entry.automation.id)) {
          const skipped = await markRunSkipped(entry.run.id, {
            step: 'queue',
            code: 'previous_running',
          });
          this.onRunStep(skipped);
          madeProgress = true;
          continue;
        }

        const run = await startCreatingTask(entry.run.id);
        if (!run) continue;

        madeProgress = true;
        this.onRunStep(run);
        this.inFlight.add(entry.automation.id);
        this.slotPool.start(() => this.runWorker(entry.automation, run));
      }

      if (!madeProgress) return;
    }
  }

  /**
   * Execute a manual run immediately, bypassing the cron queue.
   * The run should already be in `creating_task` status when this is called.
   */
  executeNow(automation: Automation, run: AutomationRun): void {
    if (this.inFlight.has(automation.id)) {
      log.warn('AutomationScheduler.executeNow: automation already in flight', {
        automationId: automation.id,
        runId: run.id,
      });
    }
    this.inFlight.add(automation.id);
    void this.runWorker(automation, run).catch((error) => {
      log.error('AutomationScheduler.executeNow worker failed', {
        automationId: automation.id,
        runId: run.id,
        error: String(error),
      });
    });
  }

  private async runWorker(automation: Automation, run: AutomationRun): Promise<void> {
    try {
      await this.executor(automation, run, this.onRunStep);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('AutomationScheduler worker failed unexpectedly', {
        automationId: automation.id,
        runId: run.id,
        error: message,
      });
      try {
        const failed = await markRunFailed(run.id, {
          step: 'create_task',
          code: 'unknown',
          message,
        });
        this.onRunStep(failed);
      } catch (markError) {
        log.error('AutomationScheduler failed to mark worker failed', {
          automationId: automation.id,
          runId: run.id,
          error: markError instanceof Error ? markError.message : String(markError),
        });
      }
    } finally {
      this.inFlight.delete(automation.id);
      if (run.triggerKind === 'cron' && automation.enabled) {
        try {
          await ensureNextCronRun(automation, Date.now());
        } catch (scheduleError) {
          log.error('AutomationScheduler failed to schedule next cron run', {
            automationId: automation.id,
            error: String(scheduleError),
          });
        }
      }
    }
  }
}

export const automationScheduler = new AutomationScheduler();
