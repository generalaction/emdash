import { log } from '@main/lib/logger';
import { dispatchEvent } from './eventDispatcher';
import { parseCursor, serializeCursor } from './pollers/cursor';
import { githubPoller } from './pollers/github-poller';
import { startPrEventSubscriber, stopPrEventSubscriber } from './pollers/pr-subscriber';
import {
  enabledEventAutomations,
  getEventCursor,
  hasEnabledEventAutomations,
  upsertEventCursor,
} from './repo';

const TICK_MS = 30_000;

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
      const automations = await enabledEventAutomations({});
      if (automations.length === 0) return;
      const projectIds = new Set(automations.map((a) => a.projectId));
      await Promise.all([...projectIds].map((projectId) => this.pollProject(projectId)));
    } catch (error) {
      log.error('AutomationEventPoller tick failed', { error: String(error) });
    } finally {
      this.ticking = false;
    }
  }

  private async pollProject(projectId: string): Promise<void> {
    try {
      const cursorRow = await getEventCursor(projectId);
      const cursor = parseCursor(cursorRow?.cursor ?? null);
      const result = await githubPoller.poll(projectId, cursor);
      const nextSerialized = serializeCursor(result.cursor);
      if (result.events.length > 0 || nextSerialized !== cursorRow?.cursor) {
        await upsertEventCursor({ projectId, cursor: nextSerialized });
      }
      await Promise.all(result.events.map((event) => dispatchEvent(event)));
    } catch (error) {
      log.error('AutomationEventPoller poll failed', { projectId, error: String(error) });
    }
  }
}

export const automationEventPoller = new AutomationEventPoller();
