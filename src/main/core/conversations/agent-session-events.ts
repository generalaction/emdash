import { HookCore, type Hookable } from '@main/lib/hookable';
import { log } from '@main/lib/logger';
import type { AgentSessionExited } from '@shared/events/agentEvents';

export type AgentSessionHooks = {
  'agent:session-exited': (event: AgentSessionExited) => void | Promise<void>;
};

class AgentSessionEvents implements Hookable<AgentSessionHooks> {
  private readonly core = new HookCore<AgentSessionHooks>((name, error) =>
    log.error(`AgentSessionEvents: ${String(name)} hook error`, error)
  );

  on<K extends keyof AgentSessionHooks>(name: K, handler: AgentSessionHooks[K]) {
    return this.core.on(name, handler);
  }

  _emit<K extends keyof AgentSessionHooks>(
    name: K,
    ...args: Parameters<AgentSessionHooks[K]>
  ): void {
    this.core.callHookBackground(name, ...args);
  }
}

export const agentSessionEvents = new AgentSessionEvents();
