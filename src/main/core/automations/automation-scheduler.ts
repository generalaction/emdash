import type { Automation } from '@shared/automations/types';
import { log } from '@main/lib/logger';
import {
  dueCronAutomations,
  enabledCronAutomations,
  getNextRunAt,
  updateAutomationSchedule,
} from './repo';
import { runAutomation } from './runtime';

const TICK_MS = 60_000;
const MISSED_GRACE_MS = 5 * 60_000;

class AutomationScheduler {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  start(): void {
    if (this.timer) return;
    this.bootstrap().catch((error) => {
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
    await this.bootstrap();
  }

  private async bootstrap(): Promise<void> {
    const now = Date.now();
    const rows = await enabledCronAutomations();
    await Promise.all(
      rows.map(async (automation) => {
        if (automation.nextRunAt && automation.nextRunAt < now - MISSED_GRACE_MS) {
          await runAutomation(automation, 'cron');
        }
        if (!automation.nextRunAt || automation.nextRunAt < now - MISSED_GRACE_MS) {
          await this.advanceNextRun(automation, now);
        }
      })
    );
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = Date.now();
      const due = await dueCronAutomations(now);
      await Promise.all(
        due.map(async (automation) => {
          await runAutomation(automation, 'cron');
          await this.advanceNextRun(automation, Date.now());
        })
      );
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
}

export const automationScheduler = new AutomationScheduler();
