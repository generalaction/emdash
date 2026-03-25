import { agentEventChannel } from '@shared/events/agentEvents';
import { events } from '@main/lib/events';
import { enrichEvent } from './event-enricher';
import { HookServer } from './hook-server';
import { isAppFocused, maybeShowNotification } from './notification';

class AgentHookService {
  private server = new HookServer();

  async start(): Promise<void> {
    await this.server.start(async (raw) => {
      const event = await enrichEvent(raw);
      event.source = 'hook';
      const appFocused = isAppFocused();
      await maybeShowNotification(event, appFocused);
      events.emit(agentEventChannel, { event, appFocused });
    });
  }

  stop(): void {
    this.server.stop();
  }
  getPort(): number {
    return this.server.getPort();
  }
  getToken(): string {
    return this.server.getToken();
  }
}

export const agentHookService = new AgentHookService();
