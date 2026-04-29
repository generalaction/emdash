import { ALL_INTEGRATION_PROVIDERS, type IntegrationProvider } from '@shared/automations/events';
import { log } from '@main/lib/logger';
import { dispatchEvent } from './eventDispatcher';
import { pollersByProvider } from './pollers';
import { parseCursor, serializeCursor } from './pollers/cursor';
import { startPrEventSubscriber, stopPrEventSubscriber } from './pollers/pr-subscriber';
import {
  enabledEventAutomations,
  getEventCursor,
  hasEnabledEventAutomations,
  upsertEventCursor,
} from './repo';

const TICK_MS = 60_000;

class AutomationEventPoller {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  start(): void {
    if (this.timer) return;
    startPrEventSubscriber();
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_MS);
    this.timer.unref?.();
    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    stopPrEventSubscriber();
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      if (!(await hasEnabledEventAutomations())) return;
      await Promise.all(ALL_INTEGRATION_PROVIDERS.map((provider) => this.pollProvider(provider)));
    } catch (error) {
      log.error('AutomationEventPoller tick failed', { error: String(error) });
    } finally {
      this.ticking = false;
    }
  }

  private async pollProvider(provider: IntegrationProvider): Promise<void> {
    const automations = await enabledEventAutomations({ provider });
    if (automations.length === 0) return;

    const projectIds = new Set(automations.map((a) => a.projectId));
    const poller = pollersByProvider[provider];

    await Promise.all(
      [...projectIds].map(async (projectId) => {
        try {
          const cursorRow = await getEventCursor(provider, projectId);
          const cursor = parseCursor(cursorRow?.cursor ?? null);
          const result = await poller.poll(projectId, cursor);
          const nextSerialized = serializeCursor(result.cursor);
          if (result.events.length > 0 || nextSerialized !== cursorRow?.cursor) {
            await upsertEventCursor({ provider, projectId, cursor: nextSerialized });
          }
          await Promise.all(result.events.map((event) => dispatchEvent(event)));
        } catch (error) {
          log.error('AutomationEventPoller poll failed', {
            provider,
            projectId,
            error: String(error),
          });
        }
      })
    );
  }
}

export const automationEventPoller = new AutomationEventPoller();
