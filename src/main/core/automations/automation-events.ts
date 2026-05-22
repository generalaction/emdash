import type { AutomationRun } from '@shared/automations/types';
import { HookCore, type Hookable } from '@main/lib/hookable';
import { log } from '@main/lib/logger';

export type AutomationHooks = {
  'automation:changed': () => void | Promise<void>;
  'automation:run:start': (run: AutomationRun) => void | Promise<void>;
  'automation:run:finish': (run: AutomationRun) => void | Promise<void>;
  'automation:run:failed': (run: AutomationRun) => void | Promise<void>;
  'automation:run:skipped': (run: AutomationRun) => void | Promise<void>;
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
