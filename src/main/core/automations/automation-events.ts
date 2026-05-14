import type { Automation } from '@shared/automations/types';
import { HookCore, type Hookable } from '@main/lib/hookable';
import { log } from '@main/lib/logger';

export type AutomationHooks = {
  'automation:created': (automation: Automation) => void | Promise<void>;
  'automation:updated': (automation: Automation) => void | Promise<void>;
  'automation:deleted': (automationId: string) => void | Promise<void>;
  'automation:changed': () => void | Promise<void>;
};

class AutomationEvents implements Hookable<AutomationHooks> {
  private readonly _core = new HookCore<AutomationHooks>((name, e) =>
    log.error(`AutomationEvents: ${String(name)} hook error`, e)
  );

  on<K extends keyof AutomationHooks>(name: K, handler: AutomationHooks[K]) {
    return this._core.on(name, handler);
  }

  _emit<K extends keyof AutomationHooks>(name: K, ...args: Parameters<AutomationHooks[K]>): void {
    this._core.callHookBackground(name, ...args);
  }
}

export const automationEvents = new AutomationEvents();
