import { HookCore, type Hookable } from '@main/lib/hookable';
import { log } from '@main/lib/logger';
import type { PtyExitInfo } from './pty';

export type PtySessionHooks = {
  exit: (sessionId: string, info: PtyExitInfo) => void | Promise<void>;
};

class PtySessionEvents implements Hookable<PtySessionHooks> {
  private readonly _core = new HookCore<PtySessionHooks>((name, e) =>
    log.error(`PtySessionEvents: ${String(name)} hook error`, e)
  );

  on<K extends keyof PtySessionHooks>(name: K, handler: PtySessionHooks[K]) {
    return this._core.on(name, handler);
  }

  emitExit(sessionId: string, info: PtyExitInfo): void {
    this._core.callHookBackground('exit', sessionId, info);
  }
}

export const ptySessionEvents = new PtySessionEvents();
