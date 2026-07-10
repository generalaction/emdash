import { eventFromUpdate, stableStringify } from '@emdash/wire';
import type { ProcessHost } from '@emdash/wire/process';
import type { Scope } from '@emdash/wire/util';
import { lazyWorker } from '@emdash/wire/worker';
import { fsWatchContract, type FsWatchStreamEvent } from '../api';
import type { WatchBackend, WatchKey, WatchOnError } from './backend';

export type ProcessWatchBackendOptions = {
  entry: string;
  scope?: Scope;
  host?: ProcessHost;
  env?: Record<string, string | undefined>;
  onError?: WatchOnError;
};

export function processWatchBackend(options: ProcessWatchBackendOptions): WatchBackend {
  const onError = options.onError ?? (() => {});
  const worker = lazyWorker({
    name: 'fs-watch',
    contract: fsWatchContract,
    entry: options.entry,
    scope: options.scope,
    host: options.host,
    env: options.env,
  });

  return {
    async subscribe(key, sink, scope) {
      const handle = await worker.get();
      const ready = createDeferred<void>();
      void ready.promise.catch(() => {});
      let awaitingInitialReady = true;
      const detach = await handle.client.events.handle(key).attach((update) => {
        const event = eventFromUpdate<FsWatchStreamEvent>(update);
        switch (event.kind) {
          case 'events':
            sink.events(event.events);
            break;
          case 'resync':
            sink.resync();
            break;
          case 'ready':
            if (awaitingInitialReady) {
              awaitingInitialReady = false;
              ready.resolve();
            } else {
              sink.resync();
            }
            break;
          case 'error': {
            const error = new Error(event.message);
            if (awaitingInitialReady) {
              awaitingInitialReady = false;
              ready.reject(error);
            } else {
              onError(`watch ${keyId(key)}`, error);
            }
            break;
          }
        }
      });
      scope.add(detach);
      scope.add(() => {
        if (awaitingInitialReady) {
          awaitingInitialReady = false;
          ready.reject(new Error(`Fs watch ${keyId(key)} disposed before ready`));
        }
      });

      try {
        await ready.promise;
      } catch (error) {
        detach();
        throw error;
      }
    },
    async dispose() {
      await worker.dispose();
    },
  };
}

function keyId(key: WatchKey): string {
  return stableStringify(key);
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(error: unknown): void;
} {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
