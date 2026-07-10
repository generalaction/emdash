import { randomUUID } from 'node:crypto';
import { eventFromUpdate } from '@emdash/wire';
import type { ProcessHost } from '@emdash/wire/process';
import type { Scope } from '@emdash/wire/util';
import { lazyWorker } from '@emdash/wire/worker';
import { fsWatchContract, type FsWatchStreamEvent } from '../api';
import type { WatchBackend, WatchKey, WatchOnError, WatchSink } from './backend';

export type ProcessWatchBackendOptions = {
  entry: string;
  scope?: Scope;
  host?: ProcessHost;
  env?: Record<string, string | undefined>;
  onError?: WatchOnError;
};

type ActiveLease = {
  leaseId: string;
  key: WatchKey;
  sink: WatchSink;
};

export function processWatchBackend(options: ProcessWatchBackendOptions): WatchBackend {
  const onError = options.onError ?? (() => {});
  const activeLeases = new Map<string, ActiveLease>();
  const worker = lazyWorker(
    {
      name: 'fs-watch',
      contract: fsWatchContract,
      entry: options.entry,
      scope: options.scope,
      host: options.host,
      env: options.env,
    },
    {
      onSpawned(handle) {
        handle.onRestarted(() => {
          void replayLeases(handle).catch((error) =>
            onError('replay fs watch leases after restart', error)
          );
        });
      },
    }
  );

  return {
    async subscribe(key, sink, scope) {
      const handle = await worker.get();
      const detach = await handle.client.events.handle(key).attach(
        (update) => {
          const event = eventFromUpdate<FsWatchStreamEvent>(update);
          if (event.kind === 'events') {
            sink.events(event.events);
          } else {
            sink.resync();
          }
        },
        { onReattach: sink.resync }
      );
      scope.add(detach);

      const leaseId = randomUUID();
      const result = await handle.client.watch({ leaseId, key });
      if (!result.success) throw new Error(result.error.message);

      activeLeases.set(leaseId, { leaseId, key, sink });
      scope.add(async () => {
        activeLeases.delete(leaseId);
        await unwatch(handle, leaseId);
      });
    },
    async dispose() {
      activeLeases.clear();
      await worker.dispose();
    },
  };

  async function replayLeases(handle: Awaited<ReturnType<typeof worker.get>>): Promise<void> {
    await Promise.all(
      [...activeLeases.values()].map(async (lease) => {
        const result = await handle.client.watch({ leaseId: lease.leaseId, key: lease.key });
        if (!result.success) {
          onError(`replay fs watch ${keyId(lease.key)}`, new Error(result.error.message));
          return;
        }
        lease.sink.resync();
      })
    );
  }

  async function unwatch(
    handle: Awaited<ReturnType<typeof worker.get>>,
    leaseId: string
  ): Promise<void> {
    try {
      const result = await handle.client.unwatch({ leaseId });
      if (!result.success) {
        onError(`unwatch fs watch ${leaseId}`, new Error(result.error.message));
      }
    } catch (error) {
      onError(`unwatch fs watch ${leaseId}`, error);
    }
  }
}

function keyId(key: WatchKey): string {
  return JSON.stringify(key);
}
