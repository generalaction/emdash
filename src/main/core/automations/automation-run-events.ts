import type { Automation, AutomationRun } from '@shared/automations/types';
import { HookCore, type Hookable } from '@main/lib/hookable';
import { log } from '@main/lib/logger';

export type AutomationRunHooks = {
  'run:queued': (run: AutomationRun, automation: Automation) => void | Promise<void>;
  'run:started': (run: AutomationRun, automation: Automation) => void | Promise<void>;
  'run:succeeded': (run: AutomationRun, automation: Automation) => void | Promise<void>;
  'run:failed': (run: AutomationRun, automation: Automation, error: string) => void | Promise<void>;
  'run:skipped': (
    run: AutomationRun,
    automation: Automation,
    reason: string
  ) => void | Promise<void>;
};

class AutomationRunEvents implements Hookable<AutomationRunHooks> {
  private readonly _core = new HookCore<AutomationRunHooks>((name, e) =>
    log.error(`AutomationRunEvents: ${String(name)} hook error`, e)
  );

  on<K extends keyof AutomationRunHooks>(name: K, handler: AutomationRunHooks[K]) {
    return this._core.on(name, handler);
  }

  _emit<K extends keyof AutomationRunHooks>(
    name: K,
    ...args: Parameters<AutomationRunHooks[K]>
  ): void {
    this._core.callHookBackground(name, ...args);
  }
}

export const automationRunEvents = new AutomationRunEvents();
