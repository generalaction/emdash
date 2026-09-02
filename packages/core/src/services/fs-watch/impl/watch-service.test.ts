import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { err, ok } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import type parcelWatcher from '@parcel/watcher';
import { describe, expect, it, vi } from 'vitest';
import { requireWatchReady, type WatchEvent } from '#services/fs-watch/api';
import type { WatchBackend, WatchBackendStart, WatchKey, WatchSink } from './backend';
import { nativeWatchBackend } from './native-backend';
import { realpathOrResolve } from './paths';
import { createWatchService } from './watch-service';

async function eventually<T>(
  read: () => T | undefined,
  timeoutMs = 5_000,
  intervalMs = 50
): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Timed out waiting for condition');
}

describe('createWatchService', () => {
  it('shares a backend subscription by normalized root and ignore set', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'emdash-fs-watch-engine-'));
    const backend = new FakeWatchBackend();
    const service = createWatchService({ backend });
    const firstEvents: WatchEvent[] = [];
    const secondEvents: WatchEvent[] = [];

    try {
      const first = service.watch(root, (events) => firstEvents.push(...events), {
        ignore: ['b', 'a'],
      });
      const second = service.watch(root, (events) => secondEvents.push(...events), {
        ignore: ['a', 'b'],
      });
      await expect(Promise.all([first.ready(), second.ready()])).resolves.toEqual([
        ok(undefined),
        ok(undefined),
      ]);

      expect(backend.subscribeCount).toBe(1);
      backend.emit({ root, ignore: ['a', 'b'] }, [{ kind: 'create', path: path.join(root, 'a') }]);
      expect(firstEvents).toHaveLength(1);
      expect(secondEvents).toHaveLength(1);

      await first.release();
      backend.emit({ root, ignore: ['a', 'b'] }, [{ kind: 'update', path: path.join(root, 'b') }]);
      expect(firstEvents).toHaveLength(1);
      expect(secondEvents).toHaveLength(2);

      await second.release();
      expect(backend.activeCount).toBe(0);
    } finally {
      await service.dispose();
    }
  });

  it('applies debounce per consumer and forwards resync signals', async () => {
    vi.useFakeTimers();
    const root = await mkdtemp(path.join(tmpdir(), 'emdash-fs-watch-debounce-'));
    const backend = new FakeWatchBackend();
    const service = createWatchService({ backend });
    const events: WatchEvent[] = [];
    let resyncs = 0;

    try {
      const handle = service.watch(root, (batch) => events.push(...batch), {
        debounceMs: 10,
        onResync: () => {
          resyncs += 1;
        },
      });
      await expect(handle.ready()).resolves.toEqual(ok(undefined));

      backend.emit({ root, ignore: [] }, [
        { kind: 'create', path: path.join(root, 'first') },
        { kind: 'update', path: path.join(root, 'second') },
      ]);
      expect(events).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(10);
      expect(events).toHaveLength(2);

      backend.resync({ root, ignore: [] });
      expect(resyncs).toBe(1);

      await handle.release();
    } finally {
      vi.useRealTimers();
      await service.dispose();
    }
  });

  it('emits real file events through ref-counted native leases', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'emdash-shared-watch-'));
    const watch = createNativeWatchService();
    const firstEvents: WatchEvent[] = [];
    const secondEvents: WatchEvent[] = [];

    try {
      const first = watch.watch(root, (events) => firstEvents.push(...events));
      const second = watch.watch(root, (events) => secondEvents.push(...events));
      await expect(Promise.all([first.ready(), second.ready()])).resolves.toEqual([
        ok(undefined),
        ok(undefined),
      ]);

      const file = path.join(root, 'created.txt');
      await writeFile(file, 'watch me\n', 'utf8');

      await eventually(() =>
        firstEvents.some((event) => path.basename(event.path) === 'created.txt') ? true : undefined
      );
      expect(secondEvents.some((event) => path.basename(event.path) === 'created.txt')).toBe(true);
      const createdEvent = firstEvents.find((event) => path.basename(event.path) === 'created.txt');
      expect(createdEvent).toMatchObject({
        kind: 'create',
        path: expect.any(String),
      });
      expect(path.isAbsolute(createdEvent?.path ?? '')).toBe(true);
      expect(firstEvents[0]).not.toHaveProperty('type');
      expect(firstEvents[0]).not.toHaveProperty('entryType');

      await first.release();
      const secondOnlyFile = path.join(root, 'second-only.txt');
      await writeFile(secondOnlyFile, 'still watching\n', 'utf8');
      await eventually(() =>
        secondEvents.some((event) => path.basename(event.path) === 'second-only.txt')
          ? true
          : undefined
      );
      expect(firstEvents.some((event) => path.basename(event.path) === 'second-only.txt')).toBe(
        false
      );

      await second.release();
    } finally {
      await watch.dispose();
    }
  });

  it('keeps the shared subscription alive across concurrent release/re-watch', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'emdash-shared-watch-relock-'));
    const watch = createNativeWatchService();
    const events: WatchEvent[] = [];

    try {
      const first = watch.watch(root, () => {});
      await expect(first.ready()).resolves.toEqual(ok(undefined));
      await first.release();
      const second = watch.watch(root, (incoming) => events.push(...incoming));
      await expect(second.ready()).resolves.toEqual(ok(undefined));

      await writeFile(path.join(root, 'after-rewatch.txt'), 'hi\n', 'utf8');
      await eventually(() =>
        events.some((event) => path.basename(event.path) === 'after-rewatch.txt') ? true : undefined
      );
      await second.release();
    } finally {
      await watch.dispose();
    }
  });

  it('surfaces watcher subscription failures through ready()', async () => {
    const root = path.join(tmpdir(), `emdash-shared-watch-missing-${Date.now()}`);
    const watch = createNativeWatchService();

    try {
      const handle = watch.watch(root, () => {});

      const failed = await handle.ready();
      expect(failed.success).toBe(false);
      await handle.release();

      await mkdir(root, { recursive: true });
      const recovered = watch.watch(root, () => {});
      await expect(recovered.ready()).resolves.toEqual(ok(undefined));
      await recovered.release();
    } finally {
      await watch.dispose();
    }
  });

  it('reports watcher subscription failures while ready() fulfills with a failure Result', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'emdash-watch-error-'));
    const backend = new DeferredWatchBackend();
    const service = createWatchService({ backend });
    const onError = vi.fn();

    try {
      const handle = service.watch(root, () => {}, { onError });
      const attempt = await eventually(() => backend.attempts[0]);
      const failure = new Error('watch attach failed');

      attempt.ready.reject(failure);

      await expect(handle.ready()).resolves.toEqual(err(failure));
      await expect(requireWatchReady(handle)).rejects.toBe(failure);
      expect(onError).toHaveBeenCalledOnce();
      expect(onError).toHaveBeenCalledWith(failure);
      await handle.release();
    } finally {
      await service.dispose();
    }
  });

  it('does not emit an unhandled rejection when ready() is not awaited', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'emdash-watch-unhandled-'));
    const backend = new DeferredWatchBackend();
    const service = createWatchService({ backend });
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    try {
      const handle = service.watch(root, () => {});
      const attempt = await eventually(() => backend.attempts[0]);
      const failure = new Error('watch attach failed');

      attempt.ready.reject(failure);
      await new Promise((resolve) => setImmediate(resolve));

      expect(unhandled).not.toHaveBeenCalled();
      await expect(handle.ready()).resolves.toEqual(err(failure));
      await handle.release();
    } finally {
      process.off('unhandledRejection', unhandled);
      await service.dispose();
    }
  });

  it('suppresses watcher subscription errors after release', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'emdash-watch-released-'));
    const backend = new DeferredWatchBackend();
    const service = createWatchService({ backend });
    const onError = vi.fn();

    try {
      const handle = service.watch(root, () => {}, { onError });
      const attempt = await eventually(() => backend.attempts[0]);
      const failure = new Error('watch attach failed after release');

      await handle.release();
      attempt.ready.reject(failure);

      const result = await handle.ready();
      expect(result.success).toBe(false);
      expect(onError).not.toHaveBeenCalled();
    } finally {
      await service.dispose();
    }
  });

  it('contains errors thrown by the attach-failure observer', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'emdash-watch-error-observer-'));
    const backend = new DeferredWatchBackend();
    const service = createWatchService({ backend });
    const failure = new Error('watch attach failed');

    try {
      const handle = service.watch(root, () => {}, {
        onError: () => {
          throw new Error('observer failed');
        },
      });
      const attempt = await eventually(() => backend.attempts[0]);

      attempt.ready.reject(failure);

      await expect(handle.ready()).resolves.toEqual(err(failure));
    } finally {
      await service.dispose();
    }
  });

  it('evicts a timed-out startup so the next watch makes a fresh attempt', async () => {
    vi.useFakeTimers();
    const root = await mkdtemp(path.join(tmpdir(), 'emdash-watch-timeout-'));
    const backend = new DeferredWatchBackend();
    const service = createWatchService({ backend, startupTimeoutMs: 25 });

    try {
      const first = service.watch(root, () => {});
      const firstReady = first.ready();
      await vi.advanceTimersByTimeAsync(25);
      const firstResult = await firstReady;
      expect(firstResult.success).toBe(false);
      if (firstResult.success) throw new Error('Expected watch startup to fail');
      expect(firstResult.error).toMatchObject({ message: 'Operation timed out after 25ms' });
      await first.release();
      expect(backend.attempts).toHaveLength(1);
      expect(backend.attempts[0]?.disposed).toBe(true);

      const second = service.watch(root, () => {});
      const secondReady = second.ready();
      await vi.advanceTimersByTimeAsync(0);
      expect(backend.attempts).toHaveLength(2);
      backend.attempts[1]?.ready.resolve(undefined);
      await expect(secondReady).resolves.toEqual(ok(undefined));

      backend.attempts[0]?.ready.resolve(undefined);
      await vi.advanceTimersByTimeAsync(0);
      expect(backend.attempts[0]?.disposed).toBe(true);
      await second.release();
    } finally {
      vi.useRealTimers();
      await service.dispose();
    }
  });

  it('retries a timed-out native startup and disposes its late subscription', async () => {
    vi.useFakeTimers();
    const root = await mkdtemp(path.join(tmpdir(), 'emdash-native-watch-timeout-'));
    const firstSubscription = deferred<parcelWatcher.AsyncSubscription>();
    const secondSubscription = deferred<parcelWatcher.AsyncSubscription>();
    const firstUnsubscribe = vi.fn(async () => {});
    const secondUnsubscribe = vi.fn(async () => {});
    const subscribe = vi
      .fn()
      .mockReturnValueOnce(firstSubscription.promise)
      .mockReturnValueOnce(secondSubscription.promise);
    const service = createWatchService({
      backend: nativeWatchBackend({ subscribe }),
      startupTimeoutMs: 1_000,
    });

    try {
      const first = service.watch(root, () => {});
      const firstReady = first.ready();
      await vi.waitFor(() => expect(subscribe).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(1_000);
      const firstResult = await firstReady;
      expect(firstResult.success).toBe(false);
      if (firstResult.success) throw new Error('Expected watch startup to fail');
      expect(firstResult.error).toMatchObject({ message: 'Operation timed out after 1000ms' });
      await first.release();

      const second = service.watch(root, () => {});
      const secondReady = second.ready();
      expect(subscribe).toHaveBeenCalledOnce();
      firstSubscription.resolve({ unsubscribe: firstUnsubscribe });
      await vi.waitFor(() => expect(subscribe).toHaveBeenCalledTimes(2));
      secondSubscription.resolve({ unsubscribe: secondUnsubscribe });
      await expect(secondReady).resolves.toEqual(ok(undefined));

      await vi.advanceTimersByTimeAsync(0);
      expect(firstUnsubscribe).toHaveBeenCalledOnce();
      await second.release();
      expect(secondUnsubscribe).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
      await service.dispose();
    }
  });

  it('starts native subscriptions FIFO without timing out queued roots', async () => {
    vi.useFakeTimers();
    const firstRoot = await mkdtemp(path.join(tmpdir(), 'emdash-native-queue-first-'));
    const secondRoot = await mkdtemp(path.join(tmpdir(), 'emdash-native-queue-second-'));
    const firstSubscription = deferred<parcelWatcher.AsyncSubscription>();
    const secondSubscription = deferred<parcelWatcher.AsyncSubscription>();
    const firstUnsubscribe = vi.fn(async () => {});
    const secondUnsubscribe = vi.fn(async () => {});
    const subscribe = vi
      .fn()
      .mockReturnValueOnce(firstSubscription.promise)
      .mockReturnValueOnce(secondSubscription.promise);
    const service = createWatchService({
      backend: nativeWatchBackend({ subscribe, maxConcurrentStarts: 1 }),
      startupTimeoutMs: 1_000,
    });

    try {
      const first = service.watch(firstRoot, () => {});
      const second = service.watch(secondRoot, () => {});
      const firstReady = first.ready();
      let secondSettled = false;
      const secondReady = second.ready().finally(() => {
        secondSettled = true;
      });

      await vi.waitFor(() => expect(subscribe).toHaveBeenCalledOnce());
      expect(subscribe.mock.calls[0]?.[0]).toBe(realpathOrResolve(firstRoot));

      await vi.advanceTimersByTimeAsync(1_000);
      const firstResult = await firstReady;
      expect(firstResult.success).toBe(false);
      expect(subscribe).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(5_000);
      expect(secondSettled).toBe(false);
      expect(subscribe).toHaveBeenCalledOnce();

      firstSubscription.resolve({ unsubscribe: firstUnsubscribe });
      await vi.waitFor(() => expect(subscribe).toHaveBeenCalledTimes(2));
      expect(subscribe.mock.calls[1]?.[0]).toBe(realpathOrResolve(secondRoot));
      secondSubscription.resolve({ unsubscribe: secondUnsubscribe });
      await expect(secondReady).resolves.toEqual(ok(undefined));

      await first.release();
      await second.release();
      expect(firstUnsubscribe).toHaveBeenCalledOnce();
      expect(secondUnsubscribe).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
      await service.dispose();
    }
  });

  it('bounds queue wait while a timed-out native startup still holds the slot', async () => {
    vi.useFakeTimers();
    const firstRoot = await mkdtemp(path.join(tmpdir(), 'emdash-native-stuck-first-'));
    const secondRoot = await mkdtemp(path.join(tmpdir(), 'emdash-native-stuck-second-'));
    const firstSubscription = deferred<parcelWatcher.AsyncSubscription>();
    const retrySubscription = deferred<parcelWatcher.AsyncSubscription>();
    const firstUnsubscribe = vi.fn(async () => {});
    const retryUnsubscribe = vi.fn(async () => {});
    const subscribe = vi
      .fn()
      .mockReturnValueOnce(firstSubscription.promise)
      .mockReturnValueOnce(retrySubscription.promise);
    const service = createWatchService({
      backend: nativeWatchBackend({ subscribe, maxConcurrentStarts: 1 }),
      startupTimeoutMs: 1_000,
      startupQueueTimeoutMs: 2_000,
    });

    try {
      const first = service.watch(firstRoot, () => {});
      const second = service.watch(secondRoot, () => {});
      const firstReady = first.ready();
      let secondSettled = false;
      const secondReady = second.ready().finally(() => {
        secondSettled = true;
      });

      await vi.waitFor(() => expect(subscribe).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(firstReady).resolves.toEqual(
        err(expect.objectContaining({ message: 'Operation timed out after 1000ms' }))
      );

      await vi.advanceTimersByTimeAsync(1_000);
      expect(secondSettled).toBe(true);
      await expect(secondReady).resolves.toEqual(
        err(expect.objectContaining({ message: 'Operation timed out after 2000ms' }))
      );
      expect(subscribe).toHaveBeenCalledOnce();

      firstSubscription.resolve({ unsubscribe: firstUnsubscribe });
      await vi.waitFor(() => expect(firstUnsubscribe).toHaveBeenCalledOnce());
      await first.release();
      await second.release();

      expect(subscribe).toHaveBeenCalledOnce();
      const retry = service.watch(secondRoot, () => {});
      const retryReady = retry.ready();
      await vi.waitFor(() => expect(subscribe).toHaveBeenCalledTimes(2));
      retrySubscription.resolve({ unsubscribe: retryUnsubscribe });
      await expect(retryReady).resolves.toEqual(ok(undefined));
      await retry.release();
      expect(retryUnsubscribe).toHaveBeenCalledOnce();
    } finally {
      firstSubscription.resolve({ unsubscribe: firstUnsubscribe });
      vi.useRealTimers();
      await service.dispose();
    }
  });

  it('cancels a queued native subscription when its final lease is released', async () => {
    const firstRoot = await mkdtemp(path.join(tmpdir(), 'emdash-native-cancel-first-'));
    const secondRoot = await mkdtemp(path.join(tmpdir(), 'emdash-native-cancel-second-'));
    const firstSubscription = deferred<parcelWatcher.AsyncSubscription>();
    const firstUnsubscribe = vi.fn(async () => {});
    const subscribe = vi.fn().mockReturnValueOnce(firstSubscription.promise);
    const service = createWatchService({
      backend: nativeWatchBackend({ subscribe, maxConcurrentStarts: 1 }),
    });

    try {
      const first = service.watch(firstRoot, () => {});
      const second = service.watch(secondRoot, () => {});
      const secondReady = second.ready();
      await vi.waitFor(() => expect(subscribe).toHaveBeenCalledOnce());

      await second.release();
      const secondResult = await secondReady;
      expect(secondResult.success).toBe(false);

      firstSubscription.resolve({ unsubscribe: firstUnsubscribe });
      await expect(first.ready()).resolves.toEqual(ok(undefined));
      await new Promise((resolve) => setImmediate(resolve));
      expect(subscribe).toHaveBeenCalledOnce();

      await first.release();
      expect(firstUnsubscribe).toHaveBeenCalledOnce();
    } finally {
      await service.dispose();
    }
  });

  it('survives native unsubscribe failure and accepts a later root', async () => {
    const firstRoot = await mkdtemp(path.join(tmpdir(), 'emdash-native-release-first-'));
    const secondRoot = await mkdtemp(path.join(tmpdir(), 'emdash-native-release-second-'));
    const failure = new Error('Unable to remove watcher');
    const firstUnsubscribe = vi.fn().mockRejectedValue(failure);
    const secondUnsubscribe = vi.fn(async () => {});
    const subscribe = vi
      .fn()
      .mockResolvedValueOnce({ unsubscribe: firstUnsubscribe })
      .mockResolvedValueOnce({ unsubscribe: secondUnsubscribe });
    const onError = vi.fn();
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const service = createWatchService({
      backend: nativeWatchBackend({ subscribe, onError }),
    });

    try {
      const first = service.watch(firstRoot, () => {});
      await expect(first.ready()).resolves.toEqual(ok(undefined));
      await first.release();
      await new Promise((resolve) => setImmediate(resolve));

      expect(onError).toHaveBeenCalledWith(`unsubscribe ${realpathOrResolve(firstRoot)}`, failure);
      expect(unhandled).not.toHaveBeenCalled();

      const second = service.watch(secondRoot, () => {});
      await expect(second.ready()).resolves.toEqual(ok(undefined));
      await second.release();
      expect(secondUnsubscribe).toHaveBeenCalledOnce();
    } finally {
      process.off('unhandledRejection', unhandled);
      await service.dispose();
    }
  });

  it('releases every native subscription after repeated many-root churn', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'emdash-native-churn-'));
    const roots = Array.from({ length: 8 }, (_, index) => path.join(parent, `root-${index}`));
    await Promise.all(roots.map((root) => mkdir(root)));
    const service = createNativeWatchService();

    try {
      for (let cycle = 0; cycle < 4; cycle += 1) {
        const handles = roots.map((root) => service.watch(root, () => {}));
        await expect(Promise.all(handles.map((handle) => handle.ready()))).resolves.toEqual(
          roots.map(() => ok(undefined))
        );
        await Promise.all(handles.map((handle) => handle.release()));
      }

      const events: WatchEvent[] = [];
      const final = service.watch(roots[0]!, (batch) => events.push(...batch));
      await expect(final.ready()).resolves.toEqual(ok(undefined));
      await writeFile(path.join(roots[0]!, 'after-churn.txt'), 'still alive\n', 'utf8');
      await eventually(() =>
        events.some((event) => path.basename(event.path) === 'after-churn.txt') ? true : undefined
      );
      await final.release();
    } finally {
      await service.dispose();
      await rm(parent, { recursive: true, force: true });
    }
  }, 15_000);

  it('disposes active handles by releasing their shared native subscription', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'emdash-shared-watch-dispose-'));
    const watch = createNativeWatchService();
    const handle = watch.watch(root, () => {});

    await expect(handle.ready()).resolves.toEqual(ok(undefined));
    await expect(watch.dispose()).resolves.toBeUndefined();
    await expect(handle.release()).resolves.toBeUndefined();
  });
});

class FakeWatchBackend implements WatchBackend {
  subscribeCount = 0;
  private readonly sinks = new Map<string, WatchSink>();

  get activeCount(): number {
    return this.sinks.size;
  }

  async subscribe(
    key: WatchKey,
    sink: WatchSink,
    scope: Scope,
    start: WatchBackendStart
  ): Promise<void> {
    start.onStart();
    this.subscribeCount += 1;
    const keyId = keyOf(key);
    this.sinks.set(keyId, sink);
    scope.add(() => {
      this.sinks.delete(keyId);
    });
  }

  emit(key: WatchKey, events: WatchEvent[]): void {
    this.sinks.get(keyOf(key))?.events(events);
  }

  resync(key: WatchKey): void {
    this.sinks.get(keyOf(key))?.resync();
  }
}

class DeferredWatchBackend implements WatchBackend {
  readonly attempts: Array<{
    ready: ReturnType<typeof deferred>;
    disposed: boolean;
  }> = [];

  async subscribe(
    _key: WatchKey,
    _sink: WatchSink,
    scope: Scope,
    start: WatchBackendStart
  ): Promise<void> {
    start.onStart();
    const attempt = { ready: deferred(), disposed: false };
    this.attempts.push(attempt);
    scope.add(() => {
      attempt.disposed = true;
    });
    await attempt.ready.promise;
  }
}

function createNativeWatchService() {
  return createWatchService({ backend: nativeWatchBackend() });
}

function keyOf(key: WatchKey): string {
  return JSON.stringify({ root: realpathOrResolve(key.root), ignore: [...key.ignore].sort() });
}

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error?: unknown): void;
} {
  let resolve: (value: T) => void = () => {};
  let reject: (error?: unknown) => void = () => {};
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
