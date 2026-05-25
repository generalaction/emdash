import { randomUUID } from 'node:crypto';
import { log } from '@main/lib/logger';
import { QUEUE_DEADLINE_EXCEEDED_ERROR } from '@shared/automations/format';
import type { Automation } from '@shared/automations/types';
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
  updateRun,
} from './repo';
import { emitRunUpdated, runQueuedAutomation } from './runtime';

const TICK_MS = 60_000;
const MISSED_GRACE_MS = 5 * 60_000;
const MAX_DUE_ENQUEUE = 100;
// Each run may allocate a worktree, PTY and agent process; keep local fan-out conservative.
const MAX_CONCURRENT_RUNS = 4;
const DEFAULT_QUEUE_DEADLINE_MS = 5 * 60_000;

export function automationRunDeadline(
  automation: Automation,
  scheduledAt: number,
  triggerKind: 'cron' | 'manual' = 'cron'
): number | null {
  if (automation.deadlinePolicy === 'none') return null;

  if (automation.deadlinePolicy === 'fixed' || triggerKind !== 'cron') {
    return scheduledAt + (automation.deadlineMs ?? DEFAULT_QUEUE_DEADLINE_MS);
  }

  return getNextRunAt(automation.trigger, scheduledAt);
}

export class AutomationScheduler {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private draining = false;
  private drainRequested = false;
  private bootstrapPromise: Promise<void> | null = null;
  private bootstrapRequested = false;
  private activeWorkers = 0;
  private unsubscribeAutomationChanged: (() => void) | null = null;
  private readonly workerId = `automation-scheduler-${randomUUID()}`;

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
    await this.bootstrap();
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
    await this.bootstrap();
  }

  private async markRunningRunsInterrupted(now = Date.now()): Promise<number> {
    const runningRuns = await listRunningRunsForRecovery();
    for (const run of runningRuns) {
      const error = run.taskId
        ? (await taskExists(run.taskId))
          ? 'interrupted_by_restart_task_preserved'
          : 'interrupted_by_restart_task_missing'
        : 'interrupted_by_restart';
      await updateRun(run.id, { status: 'failed', finishedAt: now, error });
    }
    return runningRuns.length;
  }

  private async bootstrap(): Promise<void> {
    if (this.bootstrapPromise) {
      this.bootstrapRequested = true;
      return this.bootstrapPromise;
    }

    this.bootstrapPromise = this.runBootstrapLoop();
    try {
      await this.bootstrapPromise;
    } finally {
      this.bootstrapPromise = null;
    }
  }

  private async runBootstrapLoop(): Promise<void> {
    do {
      this.bootstrapRequested = false;
      await this.bootstrapOnce();
    } while (this.bootstrapRequested);
  }

  private async bootstrapOnce(): Promise<void> {
    const now = Date.now();
    const missedBefore = now - MISSED_GRACE_MS;
    const rows = await enabledCronAutomations();
    await Promise.all(
      rows.map(async (automation) => {
        const isMissed = automation.nextRunAt != null && automation.nextRunAt < missedBefore;
        if (isMissed) {
          await this.enqueueCronAutomation(automation, automation.nextRunAt!);
        }
        if (!automation.nextRunAt || isMissed) {
          await this.advanceNextRun(automation, now);
        }
      })
    );
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
      emitRunUpdated(run);
    }
  }

  async drainQueue(): Promise<void> {
    if (this.draining) {
      this.drainRequested = true;
      return;
    }

    this.draining = true;
    try {
      do {
        this.drainRequested = false;
        while (this.activeWorkers < MAX_CONCURRENT_RUNS) {
          const capacity = MAX_CONCURRENT_RUNS - this.activeWorkers;
          const batch = await listQueuedRuns(capacity);
          if (batch.length === 0) break;

          for (const entry of batch) {
            if (this.activeWorkers >= MAX_CONCURRENT_RUNS) break;

            if (entry.run.deadlineAt != null && entry.run.deadlineAt <= Date.now()) {
              await this.markRunSkipped(entry.run.id, QUEUE_DEADLINE_EXCEEDED_ERROR);
              continue;
            }

            if (entry.automation.projectId == null) {
              await this.markRunSkipped(entry.run.id, 'no_project_attached');
              continue;
            }

            if (entry.run.triggerKind === 'cron' && (await hasRunningRuns(entry.automation.id))) {
              await this.markRunSkipped(entry.run.id, 'previous_still_running');
              continue;
            }

            const run = await claimQueuedRun(entry.run.id, this.workerId);
            if (!run) continue;

            this.activeWorkers += 1;
            automationEvents._emit('automation:run:start', run);
            void runQueuedAutomation(entry.automation, run)
              .catch(async (error) => {
                const message = error instanceof Error ? error.message : String(error);
                log.error('AutomationScheduler worker failed', {
                  automationId: entry.automation.id,
                  runId: run.id,
                  error: message,
                });
                const failed = await updateRun(run.id, {
                  status: 'failed',
                  finishedAt: Date.now(),
                  error: message,
                });
                if (failed) {
                  emitRunUpdated(failed);
                  automationEvents._emit('automation:run:failed', failed);
                }
              })
              .finally(() => {
                this.activeWorkers -= 1;
                void this.drainQueue();
              });
          }
        }
      } while (this.drainRequested && this.activeWorkers < MAX_CONCURRENT_RUNS);
    } finally {
      this.draining = false;
    }
  }

  private async markRunSkipped(runId: string, reason: string): Promise<void> {
    const skipped = await updateRun(runId, {
      status: 'skipped',
      finishedAt: Date.now(),
      error: reason,
    });
    if (skipped) {
      emitRunUpdated(skipped);
      automationEvents._emit('automation:run:skipped', skipped);
    }
  }
}

export const automationScheduler = new AutomationScheduler();
