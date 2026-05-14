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
  listQueuedCronRuns,
  markRunningRunsInterrupted,
  recoverQueuedRuns,
  updateAutomationSchedule,
} from './repo';
import { emitRunUpdated, runQueuedAutomation } from './runtime';

const TICK_MS = 60_000;
const MISSED_GRACE_MS = 5 * 60_000;
const MAX_DUE_ENQUEUE = 100;
const MAX_CONCURRENT_RUNS = 1;

class AutomationScheduler {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
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
          await this.enqueueCronAutomation(automation, automation.nextRunAt);
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
      triggerKind: 'cron',
    });
    if (run) {
      emitRunUpdated(run);
      automationRunEvents._emit('run:queued', run, automation);
    }
  }

  private async drainQueue(): Promise<void> {
    while (this.activeWorkers < MAX_CONCURRENT_RUNS) {
      const [entry] = await listQueuedCronRuns(1);
      if (!entry) return;

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
  }
}

export const automationScheduler = new AutomationScheduler();
