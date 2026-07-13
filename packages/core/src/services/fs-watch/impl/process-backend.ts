import { eventFromUpdate, stableStringify } from '@emdash/wire';
import type { ContractClient } from '@emdash/wire/api';
import type { fsWatchContract, FsWatchStreamEvent } from '@services/fs-watch/api';
import type { WatchBackend, WatchKey, WatchOnError } from './backend';

export type ProcessWatchBackendOptions = {
  client: ContractClient<typeof fsWatchContract>;
  ready?: () => Promise<void>;
  onError?: WatchOnError;
};

export function processWatchBackend(options: ProcessWatchBackendOptions): WatchBackend {
  const onError = options.onError ?? (() => {});

  return {
    async subscribe(key, sink, scope) {
      await options.ready?.();
      const ready = createDeferred<void>();
      void ready.promise.catch(() => {});
      let awaitingInitialReady = true;
      const abortReady = () => {
        if (!awaitingInitialReady) return;
        awaitingInitialReady = false;
        ready.reject(
          scope.signal.reason ?? new Error(`Fs watch ${keyId(key)} disposed before ready`)
        );
      };
      scope.signal.addEventListener('abort', abortReady, { once: true });
      const detach = await options.client.events.handle(key).attach(
        (update) => {
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
        },
        {
          // Generic topic gaps fire after the parent has reattached, but fs-watch needs a
          // stronger barrier: resync only after the child reports the native watcher is ready.
          onReattachError: (error, context) => {
            const mode = context.retrying ? 'retrying' : 'terminal';
            onError(`watch ${keyId(key)} reattach ${mode}`, error);
          },
        }
      );
      scope.add(detach);
      scope.add(() => {
        scope.signal.removeEventListener('abort', abortReady);
      });

      try {
        await ready.promise;
      } catch (error) {
        detach();
        throw error;
      }
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
