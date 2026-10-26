import { createConcurrencyLimiter, type Scope } from '@emdash/shared/concurrency';
import {
  abortableWait,
  abortReason,
  runWithTimeout,
  TimeoutError,
} from '@emdash/shared/scheduling';
import parcelWatcher from '@parcel/watcher';
import type { WatchBackendPreference } from '#services/fs-watch/api';
import type { WatchBackend, WatchKey, WatchOnError } from './backend';
import { NativeWatch, type ParcelSubscribeFn } from './native-watch';

// Parcel exposes neither cancellation nor a failure signal for a subscribe call that never
// settles. This is the single time-based failure detector for that native process boundary.
const NATIVE_STARTUP_WATCHDOG_MS = 10_000;

export type NativeWatchBackendOptions = {
  onError?: WatchOnError;
  subscribe?: ParcelSubscribeFn;
  /** Platform whose operating-system watcher serves the `'os'` preference; defaults to the host. */
  platform?: NodeJS.Platform;
};

export type NativeWatchBackend = WatchBackend & {
  readonly failureSignal: AbortSignal;
};

class NativeWatchStartupTimeoutError extends Error {
  constructor(root: string, cause: TimeoutError) {
    super(`Native watcher startup timed out for ${root}`, { cause });
    this.name = 'NativeWatchStartupTimeoutError';
  }
}

class NativeWatchStartupCancelledError extends Error {
  constructor(root: string, cause: unknown) {
    super(`Native watcher startup was cancelled for ${root}`, { cause });
    this.name = 'NativeWatchStartupCancelledError';
  }
}

export function nativeWatchBackend(options: NativeWatchBackendOptions = {}): NativeWatchBackend {
  const onError = options.onError ?? (() => {});
  const reportError = (context: string, error: unknown): void => {
    try {
      onError(context, error);
    } catch {
      // Error observers are best-effort and must not turn cleanup into an unhandled rejection.
    }
  };
  const subscribe = options.subscribe ?? parcelWatcher.subscribe;
  const platform = options.platform ?? process.platform;
  const startLimiter = createConcurrencyLimiter(1);
  const failureController = new AbortController();
  let poisoned: Error | undefined;

  const poison = (error: Error): Error => {
    if (poisoned) return poisoned;
    poisoned = error;
    failureController.abort(error);
    return error;
  };

  const disposeLateSubscription = (
    key: WatchKey,
    pending: Promise<parcelWatcher.AsyncSubscription>
  ): void => {
    void pending.then(
      (subscription) =>
        subscription
          .unsubscribe()
          .catch((error) => reportError(`unsubscribe late watch ${key.root}`, error)),
      () => {}
    );
  };

  const startNativeSubscription = async (
    key: WatchKey,
    scope: Scope,
    start: () => Promise<parcelWatcher.AsyncSubscription>
  ): Promise<parcelWatcher.AsyncSubscription> => {
    if (poisoned) throw poisoned;
    if (scope.signal.aborted) throw abortReason(scope.signal, 'Native watcher startup cancelled');
    const pending = start();
    let disposalScheduled = false;
    const scheduleDisposal = (): void => {
      if (disposalScheduled) return;
      disposalScheduled = true;
      disposeLateSubscription(key, pending);
    };
    const supervised = runWithTimeout(() => pending, {
      timeoutMs: NATIVE_STARTUP_WATCHDOG_MS,
    }).catch((error: unknown) => {
      if (!(error instanceof TimeoutError)) throw error;
      scheduleDisposal();
      throw poison(new NativeWatchStartupTimeoutError(key.root, error));
    });
    void supervised.catch(() => {});
    try {
      return await abortableWait<parcelWatcher.AsyncSubscription>(
        { signal: scope.signal },
        (settle) => {
          supervised.then(settle.resolve, settle.reject);
        }
      );
    } catch (error) {
      if (scope.signal.aborted) {
        scheduleDisposal();
        throw new NativeWatchStartupCancelledError(key.root, error);
      }
      throw error;
    }
  };

  return {
    failureSignal: failureController.signal,
    async subscribe(key, sink, scope) {
      if (poisoned) throw poisoned;
      await startLimiter.run(scope.signal, async () => {
        if (poisoned) throw poisoned;
        let initialSubscribe = true;
        const scheduledSubscribe: ParcelSubscribeFn = (...args) => {
          const start = () => subscribe(...args);
          if (initialSubscribe) {
            initialSubscribe = false;
            return startNativeSubscription(key, scope, start);
          }
          return startLimiter.run(scope.signal, () => startNativeSubscription(key, scope, start));
        };
        const native = new NativeWatch(
          key.root,
          parcelOptions(key, platform),
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
          // Parcel startup cannot be cancelled. A poisoned backend is replaced at the process
          // boundary, while the guarded subscription disposes a late native result.
          void disposal;
        });
        await native.ready();
        ready = true;
      });
    },
  };
}

function parcelOptions(key: WatchKey, platform: NodeJS.Platform): parcelWatcher.Options {
  const backend = parcelBackend(key.backend, platform);
  return backend ? { ignore: key.ignore, backend } : { ignore: key.ignore };
}

/**
 * Names the operating system's watcher explicitly because Parcel's default prefers a reachable
 * Watchman daemon on Linux and Windows. Parcel silently falls back to that default for a backend
 * the platform build lacks, so the name must match the platform. macOS already defaults to
 * FSEvents; naming it would only start a second FSEvents backend instance.
 */
function parcelBackend(
  preference: WatchBackendPreference,
  platform: NodeJS.Platform
): parcelWatcher.BackendType | undefined {
  if (preference === 'auto') return undefined;
  switch (platform) {
    case 'linux':
      return 'inotify';
    case 'win32':
      return 'windows';
    default:
      return undefined;
  }
}
