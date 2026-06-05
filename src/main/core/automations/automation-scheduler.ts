import { randomUUID } from 'node:crypto';
import { log } from '@main/lib/logger';
import { QUEUE_DEADLINE_EXCEEDED_ERROR } from '@shared/automations/format';
import type { Automation, AutomationRun } from '@shared/automations/types';
import { automationEvents } from './automation-events';
import {
  claimQueuedRun,
  dueCronAutomations,
  enabledCronAutomations,
  enqueueAutomationRun,
  getNextRunAt,
  hasRunningRuns,
  listRunningRunsForRecovery,
  listQueuedRuns,
  recoverQueuedRuns,
  taskExists,
  updateAutomationSchedule,
} from './repo';
import {
  emitClaimedRunStarted,
  emitQueuedRun,
  markRunFailed,
  markRunSkipped,
} from './run-transitions';
import { runQueuedAutomation } from './runtime';

const TICK_MS = 60_000;
const MAX_DUE_ENQUEUE = 100;
// Each run may allocate a worktree, PTY and agent process; keep local fan-out conservative.
const MAX_CONCURRENT_RUNS = 4;
const DEFAULT_QUEUE_DEADLINE_MS = 5 * 60_000;

class AutomationWorkerPool {
  private activeCount = 0;

  constructor(
    private readonly limit: number,
    private readonly onWorkerSettled: () => void
  ) {}

  get availableSlots(): number {
    return Math.max(0, this.limit - this.activeCount);
  }

  start(task: () => Promise<void>): boolean {
    if (this.availableSlots <= 0) return false;
    this.activeCount += 1;
    void task().finally(() => {
      this.activeCount -= 1;
      this.onWorkerSettled();
    });
    return true;
  }
}

export function automationRunDeadline(
  automation: Automation,
  scheduledAt: number,
  triggerKind: 'cron' | 'manual' = 'cron'
): number | null {
  if (automation.deadlinePolicy === 'none') return null;

  if (automation.deadlinePolicy === 'fixed' || triggerKind !== 'cron') {
    return scheduledAt + (automation.deadlineMs ?? DEFAULT_QUEUE_DEADLINE_MS);
  }

  if (automation.trigger.kind !== 'cron') {
    return scheduledAt + (automation.deadlineMs ?? DEFAULT_QUEUE_DEADLINE_MS);
  }

  return getNextRunAt(automation.trigger, scheduledAt);
}

export class AutomationScheduler {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private drainTail: Promise<void> = Promise.resolve();
  private bootstrapTail: Promise<void> = Promise.resolve();
  private unsubscribeAutomationChanged: (() => void) | null = null;
  private readonly workerId = `automation-scheduler-${randomUUID()}`;
  private readonly workerPool = new AutomationWorkerPool(MAX_CONCURRENT_RUNS, () => {
    void this.drainQueue();
  });

  start(): void {
    if (this.timer) return;
    this.unsubscribeAutomationChanged = automationEvents.on('automation:changed', () => {
      void this.reload();
    });
    this.recoverAndBootstrap().catch((error) => {
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
    this.unsubscribeAutomationChanged?.();
    this.unsubscribeAutomationChanged = null;
  }

  async reload(): Promise<void> {
    const run = this.bootstrapTail.then(() => this.bootstrapDueRuns());
    this.bootstrapTail = run.catch((error) => {
      log.error('AutomationScheduler bootstrap failed', { error: String(error) });
    });
    await this.bootstrapTail;
  }

  private async recoverAndBootstrap(): Promise<void> {
    const [recoveredQueued, recovered] = await Promise.all([
      recoverQueuedRuns(),
      this.markRunningRunsInterrupted(),
    ]);
    if (recoveredQueued > 0) {
      log.info('AutomationScheduler recovered queued runs', { recovered: recoveredQueued });
    }
    if (recovered > 0) {
      log.warn('AutomationScheduler recovered interrupted runs', { recovered });
    }
    await this.reload();
  }

  private async markRunningRunsInterrupted(now = Date.now()): Promise<number> {
    const runningRuns = await listRunningRunsForRecovery();
    for (const run of runningRuns) {
      const error = run.taskId
        ? (await taskExists(run.taskId))
          ? 'interrupted_by_restart_task_preserved'
          : 'interrupted_by_restart_task_missing'
        : 'interrupted_by_restart';
      await markRunFailed(run.id, { error, finishedAt: now });
    }
    return runningRuns.length;
  }

  private async bootstrapDueRuns(): Promise<void> {
    const now = Date.now();
    const rows = await enabledCronAutomations();
    const results = await Promise.allSettled(
      rows.map(async (automation) => {
        const isDue = automation.nextRunAt != null && automation.nextRunAt <= now;
        if (isDue) {
          await this.enqueueCronAutomation(automation, automation.nextRunAt!);
        }
        if (!automation.nextRunAt || isDue) {
          await this.advanceNextRun(automation, now);
        }
      })
    );
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        log.error('AutomationScheduler bootstrap automation failed', {
          automationId: rows[index]?.id,
          error: String(result.reason),
        });
      }
    });
    await this.drainQueue();
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = Date.now();
      const due = await dueCronAutomations(now);
      for (const automation of due.slice(0, MAX_DUE_ENQUEUE)) {
        await this.enqueueCronAutomation(automation, automation.nextRunAt ?? now);
        await this.advanceNextRun(automation, Date.now());
      }
      await this.drainQueue();
    } catch (error) {
      log.error('AutomationScheduler tick failed', { error: String(error) });
    } finally {
      this.ticking = false;
    }
  }

  private async advanceNextRun(automation: Automation, from: number): Promise<void> {
    if (automation.trigger.kind !== 'cron') return;
    const nextRunAt = getNextRunAt(automation.trigger, from);
    await updateAutomationSchedule(automation.id, { nextRunAt });
  }

  private async enqueueCronAutomation(automation: Automation, scheduledAt: number): Promise<void> {
    const run = await enqueueAutomationRun({
      automationId: automation.id,
      scheduledAt,
      deadlineAt: automationRunDeadline(automation, scheduledAt, 'cron'),
      triggerKind: 'cron',
    });
    if (run) {
      emitQueuedRun(run);
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
    while (this.workerPool.availableSlots > 0) {
      const capacity = this.workerPool.availableSlots;
      const batch = await listQueuedRuns(capacity);
      if (batch.length === 0) return;

      let madeProgress = false;
      for (const entry of batch) {
        if (this.workerPool.availableSlots <= 0) return;

        if (entry.run.deadlineAt != null && entry.run.deadlineAt <= Date.now()) {
          await markRunSkipped(entry.run.id, QUEUE_DEADLINE_EXCEEDED_ERROR);
          madeProgress = true;
          continue;
        }

        if (entry.automation.projectId == null) {
          await markRunSkipped(entry.run.id, 'no_project_attached');
          madeProgress = true;
          continue;
        }

        if (await hasRunningRuns(entry.automation.id)) {
          await markRunSkipped(entry.run.id, 'previous_still_running');
          madeProgress = true;
          continue;
        }

        const run = await claimQueuedRun(entry.run.id, this.workerId);
        if (!run) continue;

        madeProgress = true;
        emitClaimedRunStarted(run);
        this.workerPool.start(() => this.runWorker(entry.automation, run));
      }

      if (!madeProgress) return;
    }
  }

  private async runWorker(automation: Automation, run: AutomationRun): Promise<void> {
    try {
      await runQueuedAutomation(automation, run);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('AutomationScheduler worker failed', {
        automationId: automation.id,
        runId: run.id,
        error: message,
      });
      try {
        await markRunFailed(run.id, { error: message });
      } catch (markError) {
        log.error('AutomationScheduler failed to mark worker failed', {
          automationId: automation.id,
          runId: run.id,
          error: markError instanceof Error ? markError.message : String(markError),
        });
      }
    }
  }
}

export const automationScheduler = new AutomationScheduler();
