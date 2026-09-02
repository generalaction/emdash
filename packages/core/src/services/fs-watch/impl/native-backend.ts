import { createConcurrencyLimiter } from '@emdash/shared/concurrency';
import parcelWatcher from '@parcel/watcher';
import type { WatchBackend, WatchOnError } from './backend';
import { NativeWatch, type ParcelSubscribeFn } from './native-watch';

const DEFAULT_MAX_CONCURRENT_STARTS = 1;

export type NativeWatchBackendOptions = {
  onError?: WatchOnError;
  subscribe?: ParcelSubscribeFn;
  maxConcurrentStarts?: number;
};

export function nativeWatchBackend(options: NativeWatchBackendOptions = {}): WatchBackend {
  const onError = options.onError ?? (() => {});
  const reportError = (context: string, error: unknown): void => {
    try {
      onError(context, error);
    } catch {
      // Error observers are best-effort and must not turn cleanup into an unhandled rejection.
    }
  };
  const subscribe = options.subscribe ?? parcelWatcher.subscribe;
  const startLimiter = createConcurrencyLimiter(
    options.maxConcurrentStarts ?? DEFAULT_MAX_CONCURRENT_STARTS
  );

  return {
    async subscribe(key, sink, scope, start) {
      const startSignal = AbortSignal.any([scope.signal, start.signal]);
      await startLimiter.run(startSignal, async () => {
        start.onStart();
        let initialSubscribe = true;
        const scheduledSubscribe: ParcelSubscribeFn = (...args) => {
          if (initialSubscribe) {
            initialSubscribe = false;
            return subscribe(...args);
          }
          return startLimiter.run(scope.signal, () => subscribe(...args));
        };
        const native = new NativeWatch(
          key.root,
          key.ignore,
          sink.events,
          sink.resync,
          reportError,
          scheduledSubscribe
        );
        let ready = false;
        scope.add(() => {
          const disposal = native
            .dispose()
            .catch((error) => reportError(`dispose watch ${key.root}`, error));
          if (ready) return disposal;
          // A Parcel subscribe can remain pending after the channel startup timeout. Start cleanup
          // without making scope disposal wait for that promise; NativeWatch disposes a late result.
          void disposal;
        });
        await native.ready();
        ready = true;
      });
    },
  };
}
