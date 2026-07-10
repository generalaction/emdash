import { randomUUID } from 'node:crypto';
import { eventFromUpdate } from '@emdash/wire';
import type { ManagedProcess, ProcessHost } from '@emdash/wire/process';
import { childProcessHost } from '@emdash/wire/process/node';
import { spawnRuntime } from '@emdash/wire/util/process-runtime';
import { fsWatchContract, type FsWatchStreamEvent } from '../api';
import type { WatchBackend, WatchKey, WatchOnError, WatchSink } from './backend';

export type ProcessWatchBackendOptions = {
  entry: string;
  host?: ProcessHost;
  env?: Record<string, string | undefined>;
  onError?: WatchOnError;
  onProcess?: (process: ManagedProcess) => void;
};

type ActiveLease = {
  leaseId: string;
  key: WatchKey;
  sink: WatchSink;
};

export function processWatchBackend(options: ProcessWatchBackendOptions): WatchBackend {
  const onError = options.onError ?? (() => {});
  const activeLeases = new Map<string, ActiveLease>();
  type FsWatchRuntimeHandle = Awaited<ReturnType<typeof spawnFsWatchRuntime>>;
  let handlePromise: Promise<FsWatchRuntimeHandle> | null = null;

  return {
    async subscribe(key, sink, scope) {
      const handle = await ensureSpawned();
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
      const handle = await handlePromise?.catch(() => null);
      handlePromise = null;
      await handle?.dispose();
    },
  };

  function ensureSpawned(): Promise<FsWatchRuntimeHandle> {
    if (handlePromise) return handlePromise;

    handlePromise = spawnFsWatchRuntime(options).catch((error) => {
      handlePromise = null;
      throw error;
    });
    return handlePromise;
  }

  async function spawnFsWatchRuntime(spawnOptions: ProcessWatchBackendOptions) {
    const handle = await spawnRuntime({
      host: spawnOptions.host ?? childProcessHost(),
      contract: fsWatchContract,
      spec: {
        entry: spawnOptions.entry,
        env: spawnOptions.env,
        supervision: { restart: 'on-failure', backoffMs: [250, 1_000, 2_500], maxRestarts: 5 },
      },
      onProcess: spawnOptions.onProcess,
    });

    handle.onRestarted(() => {
      void replayLeases(handle).catch((error) =>
        onError('replay fs watch leases after restart', error)
      );
    });
    return handle;
  }

  async function replayLeases(handle: FsWatchRuntimeHandle): Promise<void> {
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

  async function unwatch(handle: FsWatchRuntimeHandle, leaseId: string): Promise<void> {
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
