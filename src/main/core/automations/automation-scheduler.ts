import { randomUUID } from 'node:crypto';
import type { Automation } from '@shared/automations/types';
import { log } from '@main/lib/logger';
import { automationEvents } from './automation-events';
import { automationRunEvents } from './automation-run-events';
import {
  claimQueuedRun,
  dueCronAutomations,
  enabledCronAutomations,
  enqueueAutomationRun,
  getNextRunAt,
  hasRunningRuns,
  listQueuedRuns,
  markRunningRunsInterrupted,
  recoverQueuedRuns,
  updateAutomationSchedule,
  updateRun,
} from './repo';
import { emitRunUpdated, runQueuedAutomation } from './runtime';

const TICK_MS = 60_000;
const MISSED_GRACE_MS = 5 * 60_000;
const MAX_DUE_ENQUEUE = 100;
const MAX_CONCURRENT_RUNS = 100;
const QUEUE_DEADLINE_MS = 5 * 60_000;

export function automationRunDeadline(scheduledAt: number): number {
  return scheduledAt + QUEUE_DEADLINE_MS;
}

export class AutomationScheduler {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private draining = false;
  private activeWorkers = 0;
  private unsubscribeAutomationChanged: (() => void) | null = null;
  private readonly workerId = `automation-scheduler-${randomUUID()}`;

  start(): void {
    if (this.timer) return;
    this.unsubscribeAutomationChanged = automationEvents.on('automation:changed', () =>
      this.reload()
    );
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
      markRunningRunsInterrupted(),
    ]);
    if (recoveredQueued > 0) {
      log.info('AutomationScheduler recovered queued runs', { recovered: recoveredQueued });
    }
    if (recovered > 0) {
      log.warn('AutomationScheduler recovered interrupted runs', { recovered });
    }
    await this.bootstrap();
  }

  private async bootstrap(): Promise<void> {
    const now = Date.now();
    const rows = await enabledCronAutomations();
    await Promise.all(
      rows.map(async (automation) => {
        if (automation.nextRunAt && automation.nextRunAt < now - MISSED_GRACE_MS) {
          await this.enqueueCronAutomation(automation, automation.nextRunAt, now);
        }
        if (!automation.nextRunAt || automation.nextRunAt < now - MISSED_GRACE_MS) {
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
        const enqueueStartedAt = Date.now();
        await this.enqueueCronAutomation(automation, automation.nextRunAt ?? now, enqueueStartedAt);
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

  private async enqueueCronAutomation(
    automation: Automation,
    scheduledAt: number,
    queuedAt = scheduledAt
  ): Promise<void> {
    const run = await enqueueAutomationRun({
      automationId: automation.id,
      scheduledAt,
      deadlineAt: automationRunDeadline(queuedAt),
      triggerKind: 'cron',
    });
    if (run) {
      emitRunUpdated(run);
      automationRunEvents._emit('run:queued', run, automation);
    }
  }

  async drainQueue(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.activeWorkers < MAX_CONCURRENT_RUNS) {
        const [entry] = await listQueuedRuns(1);
        if (!entry) return;

        if (entry.run.deadlineAt != null && entry.run.deadlineAt <= Date.now()) {
          const skipped = await updateRun(entry.run.id, {
            status: 'skipped',
            finishedAt: Date.now(),
            error: 'queue_deadline_exceeded',
          });
          if (skipped) {
            emitRunUpdated(skipped);
            automationRunEvents._emit(
              'run:skipped',
              skipped,
              entry.automation,
              'queue_deadline_exceeded'
            );
          }
          continue;
        }

        if (entry.run.triggerKind === 'cron' && (await hasRunningRuns(entry.automation.id))) {
          const skipped = await updateRun(entry.run.id, {
            status: 'skipped',
            finishedAt: Date.now(),
            error: 'previous_still_running',
          });
          if (skipped) {
            emitRunUpdated(skipped);
            automationRunEvents._emit(
              'run:skipped',
              skipped,
              entry.automation,
              'previous_still_running'
            );
          }
          continue;
        }

        const run = await claimQueuedRun(entry.run.id, this.workerId);
        if (!run) continue;

        this.activeWorkers += 1;
        void runQueuedAutomation(entry.automation, run)
          .catch((error) => {
            log.error('AutomationScheduler worker failed', {
              automationId: entry.automation.id,
              runId: run.id,
              error: String(error),
            });
          })
          .finally(() => {
            this.activeWorkers -= 1;
            void this.drainQueue();
          });
      }
    } finally {
      this.draining = false;
    }
  }
}

export const automationScheduler = new AutomationScheduler();
