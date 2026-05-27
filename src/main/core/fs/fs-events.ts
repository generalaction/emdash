import { HookCore, type Hookable } from '@main/lib/hookable';
import { log } from '@main/lib/logger';
import type { FileWatchEvent } from '@shared/fs';

export type FsHooks = {
  'watch:event': (event: {
    projectId: string;
    workspaceId: string;
    events: FileWatchEvent[];
  }) => void | Promise<void>;
};

class FsEvents implements Hookable<FsHooks> {
  private readonly _core = new HookCore<FsHooks>((name, e) =>
    log.error(`FsEvents: ${String(name)} hook error`, e)
  );

  on<K extends keyof FsHooks>(name: K, handler: FsHooks[K]) {
    return this._core.on(name, handler);
  }

  emitWatchEvent(event: {
    projectId: string;
    workspaceId: string;
    events: FileWatchEvent[];
  }): void {
    this._core.callHookBackground('watch:event', event);
  }
}

export const fsEvents = new FsEvents();
