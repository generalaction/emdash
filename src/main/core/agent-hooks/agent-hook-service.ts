import { agentEventChannel } from '@shared/events/agentEvents';
import { events } from '@main/lib/events';
import type { IDisposable, IInitializable } from '@main/lib/lifecycle';
import { enrichEvent } from './event-enricher';
import { HookServer, type RouteHandler } from './hook-server';
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
  /**
   * Register an additional authenticated route on the hook server.
   * Used by the coordination service to expose GET /coord/* endpoints
   * without spinning up a second HTTP server.
   */
  addRoute(method: string, pathname: string, handler: RouteHandler): void {
    this.server.addRoute(method, pathname, handler);
  }
}

export const agentHookService = new AgentHookService();
