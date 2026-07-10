import { err, ok } from '@emdash/shared';
import { createEventStreamHost } from '@emdash/wire';
import { createController, type Controller } from '@emdash/wire/api';
import type { Scope } from '@emdash/wire/util';
import { fsWatchContract, type FsWatchKey } from '../api';
import type { IWatchService, WatchHandle } from '../api';
import { nativeWatchBackend } from './native-backend';
import { createWatchService } from './watch-service';

export type CreateFsWatchControllerOptions = {
  scope: Scope;
  onError?: (context: string, error: unknown) => void;
  service?: IWatchService;
};

export function createFsWatchController(options: CreateFsWatchControllerOptions): Controller {
  const events = createEventStreamHost(fsWatchContract.events);
  const service =
    options.service ??
    createWatchService({
      backend: nativeWatchBackend({ onError: options.onError }),
      scope: options.scope,
      onError: options.onError,
    });
  const leases = new Map<string, WatchHandle>();

  options.scope.add(() => {
    events.dispose();
    return service.dispose();
  });

  return createController(fsWatchContract, {
    events,
    watch: async ({ leaseId, key }) => {
      await releaseLease(leaseId);
      const handle = service.watch(
        key.root,
        (batch) => events.emit(key, { kind: 'events', events: batch }),
        {
          ignore: key.ignore,
          onResync: () => events.emit(key, { kind: 'resync' }),
        }
      );
      leases.set(leaseId, handle);

      try {
        await handle.ready();
        return ok(undefined);
      } catch (error) {
        leases.delete(leaseId);
        await handle.release();
        return err({ message: errorMessage(error, key) });
      }
    },
    unwatch: async ({ leaseId }) => {
      await releaseLease(leaseId);
      return ok(undefined);
    },
  });

  async function releaseLease(leaseId: string): Promise<void> {
    const handle = leases.get(leaseId);
    if (!handle) return;
    leases.delete(leaseId);
    await handle.release();
  }
}

function errorMessage(error: unknown, key: FsWatchKey): string {
  if (error instanceof Error) return error.message;
  return `Failed to watch ${key.root}: ${String(error)}`;
}
