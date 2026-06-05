import { log } from '@main/lib/logger';
import type { EmdashServerConnection } from '@main/core/settings/schema';
import type { Automation } from '@shared/automations/types';
import { enqueueAutomationRun, webhookAutomations } from './repo';
import { emitQueuedRun } from './run-transitions';
import { appSettingsService } from '@main/core/settings/settings-service';

const POLL_INTERVAL_MS = 5_000;
const BACKOFF_INTERVAL_MS = 30_000;
const FAILURE_THRESHOLD = 3;

interface PendingEvent {
  id: string;
  automationToken: string;
  source: string;
  payload: unknown;
  createdAt: number;
}

async function fetchPendingEvents(
  server: EmdashServerConnection
): Promise<PendingEvent[]> {
  const res = await fetch(`${server.url}/api/events/pending`, {
    headers: { Authorization: `Bearer ${server.apiKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`emdash-server returned ${res.status}`);
  const data = (await res.json()) as { events: PendingEvent[] };
  return data.events;
}

async function ackEvent(
  server: EmdashServerConnection,
  eventId: string,
  error?: string
): Promise<void> {
  await fetch(`${server.url}/api/events/${eventId}/ack`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${server.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: error ? JSON.stringify({ error }) : '{}',
    signal: AbortSignal.timeout(10_000),
  });
}

class ServerPoller {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private consecutiveFailures = 0;
  private stopped = false;

  constructor(
    private readonly server: EmdashServerConnection,
    private readonly getAutomations: () => Promise<Automation[]>
  ) {}

  start(): void {
    this.stopped = false;
    this.scheduleNext(POLL_INTERVAL_MS);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(ms: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), ms);
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    try {
      const events = await fetchPendingEvents(this.server);
      this.consecutiveFailures = 0;

      const automations = await this.getAutomations();
      const byToken = new Map(
        automations
          .map((a) => {
            if (a.trigger.kind !== 'webhook') return null;
            return [a.trigger.token, a] as [string, Automation];
          })
          .filter((x): x is [string, Automation] => x !== null)
      );

      for (const event of events) {
        const automation = byToken.get(event.automationToken);
        if (!automation) {
          await ackEvent(this.server, event.id).catch(() => {});
          continue;
        }
        try {
          const run = await enqueueAutomationRun({
            automationId: automation.id,
            scheduledAt: event.createdAt,
            deadlineAt: null,
            triggerKind: 'webhook',
          });
          if (run) {
            emitQueuedRun(run);
          } else {
            log.warn('WebhookWatcher: run enqueue skipped (automation busy)', {
              automationId: automation.id,
              eventId: event.id,
            });
          }
          await ackEvent(this.server, event.id);
        } catch (err) {
          await ackEvent(this.server, event.id, String(err)).catch(() => {});
        }
      }
      this.scheduleNext(POLL_INTERVAL_MS);
    } catch (err) {
      this.consecutiveFailures++;
      log.warn('WebhookWatcher: poll failed', {
        serverId: this.server.id,
        error: String(err),
        consecutiveFailures: this.consecutiveFailures,
      });
      const delay =
        this.consecutiveFailures >= FAILURE_THRESHOLD
          ? BACKOFF_INTERVAL_MS
          : POLL_INTERVAL_MS;
      this.scheduleNext(delay);
    }
  }
}

class WebhookWatcherService {
  private pollers = new Map<string, ServerPoller>();

  start(): void {
    void appSettingsService.get('emdashServers').then((settings) => {
      if (!settings || settings.length === 0) return;
      for (const server of settings) {
      if (this.pollers.has(server.id)) continue;
      const poller = new ServerPoller(server, webhookAutomations);
      this.pollers.set(server.id, poller);
      poller.start();
        log.info('WebhookWatcher: started polling', { serverId: server.id, url: server.url });
      }
    });
  }

  stop(): void {
    for (const poller of this.pollers.values()) {
      poller.stop();
    }
    this.pollers.clear();
  }
}

export const webhookWatcher = new WebhookWatcherService();
