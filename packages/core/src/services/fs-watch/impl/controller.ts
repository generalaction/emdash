import { createEventStreamHost, stableStringify } from '@emdash/wire';
import { createController, type Controller } from '@emdash/wire/api';
import type { Scope } from '@emdash/wire/util';
import { fsWatchContract, type FsWatchKey } from '@services/fs-watch/api';
import type { IWatchService, WatchHandle } from '@services/fs-watch/api';
import { nativeWatchBackend } from './native-backend';
import { createWatchService } from './watch-service';

export type CreateFsWatchControllerOptions = {
  scope: Scope;
  onError?: (context: string, error: unknown) => void;
  service?: IWatchService;
};

type ActiveWatch = {
  handle: WatchHandle;
};

export function createFsWatchController(options: CreateFsWatchControllerOptions): Controller {
  const activeWatches = new Map<string, ActiveWatch>();
  const events = createEventStreamHost(fsWatchContract.events, {
    onActive: (key) => {
      void activateWatch(key);
    },
    onIdle: (key) => {
      void releaseWatch(key);
    },
  });
  const service =
    options.service ??
    createWatchService({
      backend: nativeWatchBackend({ onError: options.onError }),
      scope: options.scope,
      onError: options.onError,
    });

  options.scope.add(async () => {
    events.dispose();
    await Promise.allSettled([...activeWatches.values()].map((watch) => watch.handle.release()));
    activeWatches.clear();
    await service.dispose();
  });

  return createController(fsWatchContract, {
    events,
  });

  async function activateWatch(key: FsWatchKey): Promise<void> {
    const id = keyId(key);
    if (activeWatches.has(id)) return;

    let watch: ActiveWatch | undefined;
    try {
      const handle = service.watch(
        key.root,
        (batch) => events.emit(key, { kind: 'events', events: batch }),
        {
          ignore: key.ignore,
          onResync: () => events.emit(key, { kind: 'resync' }),
        }
      );
      watch = { handle };
      activeWatches.set(id, watch);

      await handle.ready();
      if (activeWatches.get(id) === watch) events.emit(key, { kind: 'ready' });
    } catch (error) {
      if (!watch || activeWatches.get(id) === watch) {
        if (watch) activeWatches.delete(id);
        events.emit(key, { kind: 'error', message: errorMessage(error, key) });
      }
      try {
        await watch?.handle.release();
      } catch (releaseError) {
        options.onError?.(`release failed watch ${id}`, releaseError);
      }
      options.onError?.(`watch ${keyId(key)}`, error);
    }
  }

  async function releaseWatch(key: FsWatchKey): Promise<void> {
    const id = keyId(key);
    const watch = activeWatches.get(id);
    if (!watch) return;
    activeWatches.delete(id);
    try {
      await watch.handle.release();
    } catch (error) {
      options.onError?.(`release watch ${id}`, error);
    }
  }
}

function keyId(key: FsWatchKey): string {
  return stableStringify(key);
}

function errorMessage(error: unknown, key: FsWatchKey): string {
  if (error instanceof Error) return error.message;
  return `Failed to watch ${key.root}: ${String(error)}`;
}
