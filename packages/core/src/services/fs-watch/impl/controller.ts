import { once } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import { abortableWait } from '@emdash/shared/scheduling';
import { stableStringify } from '@emdash/shared/util';
import { createEventStreamHost } from '@emdash/wire/live';
import { createController, type Controller } from '@emdash/wire/rpc';
import { fsWatchContract, requireWatchReady, type FsWatchKey } from '#services/fs-watch/api';
import type { IWatchService } from '#services/fs-watch/api';

export type CreateFsWatchControllerOptions = {
  scope: Scope;
  service: IWatchService;
  onError?: (context: string, error: unknown) => void;
};

export function createFsWatchController(options: CreateFsWatchControllerOptions): Controller {
  const service = options.service;
  const events = createEventStreamHost(fsWatchContract.events, {
    activate: async (key, signal) => {
      const handle = service.watch(
        key.root,
        (batch) => events.emit(key, { kind: 'events', events: batch }),
        {
          ignore: key.ignore,
          onResync: () => events.emit(key, { kind: 'resync' }),
        }
      );
      const release = once(() => handle.release());
      try {
        await abortableWait<void>({ signal }, (settle) => {
          requireWatchReady(handle).then(settle.resolve, settle.reject);
        });
      } catch (error) {
        try {
          await release();
        } catch (releaseError) {
          options.onError?.(`release failed watch ${keyId(key)}`, releaseError);
        }
        if (!signal.aborted) options.onError?.(`watch ${keyId(key)}`, error);
        throw error;
      }
      return () => {
        void release().catch((error) => options.onError?.(`release watch ${keyId(key)}`, error));
      };
    },
  });

  options.scope.add(async () => {
    events.dispose();
    await service.dispose();
  });

  return createController(fsWatchContract, {
    events,
  });
}

function keyId(key: FsWatchKey): string {
  return stableStringify(key);
}
