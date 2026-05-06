import { agentEventChannel } from '@shared/events/agentEvents';
import { events } from '@main/lib/events';
import type { IDisposable, IInitializable } from '@main/lib/lifecycle';
import { enrichEvent } from './event-enricher';
import { HookServer } from './hook-server';
import { isAppFocused, maybeShowNotification } from './notification';

class AgentHookService implements IInitializable, IDisposable {
  private server = new HookServer();

  async initialize(): Promise<void> {
    await this.server.start(async (raw) => {
      const event = await enrichEvent(raw);
      event.source = 'hook';
      const appFocused = isAppFocused();
      await maybeShowNotification(event, appFocused);
      events.emit(agentEventChannel, { event, appFocused });
    });
  }

  dispose(): void {
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
