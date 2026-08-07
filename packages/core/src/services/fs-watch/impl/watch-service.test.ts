import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Scope } from '@emdash/shared/concurrency';
import type parcelWatcher from '@parcel/watcher';
import { describe, expect, it, vi } from 'vitest';
import type { WatchEvent } from '#services/fs-watch/api';
import type { WatchBackend, WatchKey, WatchSink } from './backend';
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
      await Promise.all([first.ready(), second.ready()]);

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
      await handle.ready();

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
      await Promise.all([first.ready(), second.ready()]);

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
      await first.ready();
      await first.release();
      const second = watch.watch(root, (incoming) => events.push(...incoming));
      await second.ready();

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

      await expect(handle.ready()).rejects.toThrow();
      await handle.release();

      await mkdir(root, { recursive: true });
      const recovered = watch.watch(root, () => {});
      await expect(recovered.ready()).resolves.toBeUndefined();
      await recovered.release();
    } finally {
      await watch.dispose();
    }
  });

  it('evicts a timed-out startup so the next watch makes a fresh attempt', async () => {
    vi.useFakeTimers();
    const root = await mkdtemp(path.join(tmpdir(), 'emdash-watch-timeout-'));
    const backend = new DeferredWatchBackend();
    const service = createWatchService({ backend, startupTimeoutMs: 25 });

    try {
      const first = service.watch(root, () => {});
      const firstFailure = expect(first.ready()).rejects.toThrow('Operation timed out after 25ms');
      await vi.advanceTimersByTimeAsync(25);
      await firstFailure;
      await first.release();
      expect(backend.attempts).toHaveLength(1);
      expect(backend.attempts[0]?.disposed).toBe(true);

      const second = service.watch(root, () => {});
      const secondReady = second.ready();
      await vi.advanceTimersByTimeAsync(0);
      expect(backend.attempts).toHaveLength(2);
      backend.attempts[1]?.ready.resolve(undefined);
      await expect(secondReady).resolves.toBeUndefined();

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
      const firstFailure = expect(first.ready()).rejects.toThrow(
        'Operation timed out after 1000ms'
      );
      await vi.advanceTimersByTimeAsync(1_000);
      await firstFailure;
      await first.release();

      const second = service.watch(root, () => {});
      const secondReady = expect(second.ready()).resolves.toBeUndefined();
      await vi.waitFor(() => expect(subscribe).toHaveBeenCalledTimes(2));
      secondSubscription.resolve({ unsubscribe: secondUnsubscribe });
      await secondReady;

      firstSubscription.resolve({ unsubscribe: firstUnsubscribe });
      await vi.advanceTimersByTimeAsync(0);
      expect(firstUnsubscribe).toHaveBeenCalledOnce();
      await second.release();
      expect(secondUnsubscribe).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
      await service.dispose();
    }
  });

  it('disposes active handles by releasing their shared native subscription', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'emdash-shared-watch-dispose-'));
    const watch = createNativeWatchService();
    const handle = watch.watch(root, () => {});

    await handle.ready();
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

  async subscribe(key: WatchKey, sink: WatchSink, scope: Scope): Promise<void> {
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

  async subscribe(_key: WatchKey, _sink: WatchSink, scope: Scope): Promise<void> {
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

function deferred<T = void>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
