import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type parcelWatcher from '@parcel/watcher';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeWatch } from './native-watch';

const watcherMock = vi.hoisted(() => ({
  subscribe: vi.fn<typeof parcelWatcher.subscribe>(),
}));

vi.mock('@parcel/watcher', () => ({
  default: {
    subscribe: watcherMock.subscribe,
  },
}));

type SubscribeCallback = Parameters<typeof parcelWatcher.subscribe>[1];

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('NativeWatch', () => {
  let root: string;
  let callbacks: SubscribeCallback[];

  beforeEach(async () => {
    vi.useFakeTimers();
    root = await mkdtemp(path.join(tmpdir(), 'emdash-native-watch-'));
    callbacks = [];
    watcherMock.subscribe.mockReset();
  });

  function queueSubscription(
    subscription: parcelWatcher.AsyncSubscription | Promise<parcelWatcher.AsyncSubscription>
  ): void {
    watcherMock.subscribe.mockImplementationOnce((_root, callback) => {
      callbacks.push(callback);
      return Promise.resolve(subscription);
    });
  }

  async function openWatch(resync = vi.fn(), onError = vi.fn()): Promise<NativeWatch> {
    const watch = new NativeWatch(root, [], vi.fn(), resync, onError);
    await watch.ready();
    return watch;
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces dropped-event errors into a resync without replacing the subscription', async () => {
    const unsubscribe = vi.fn(async () => {});
    queueSubscription({ unsubscribe });
    const resync = vi.fn();
    const onError = vi.fn();
    const watch = await openWatch(resync, onError);

    const dropped = new Error(
      'Events were dropped by the FSEvents client. File system must be re-scanned.'
    );
    callbacks[0](dropped, []);
    callbacks[0](dropped, []);
    await vi.advanceTimersByTimeAsync(250);

    expect(onError).toHaveBeenCalledTimes(2);
    expect(resync).toHaveBeenCalledOnce();
    expect(watcherMock.subscribe).toHaveBeenCalledOnce();
    expect(unsubscribe).not.toHaveBeenCalled();

    await watch.dispose();
  });

  it('unsubscribes the previous subscription before starting a replacement', async () => {
    const stopped = deferred();
    const firstUnsubscribe = vi.fn(() => stopped.promise);
    const secondUnsubscribe = vi.fn(async () => {});
    queueSubscription({ unsubscribe: firstUnsubscribe });
    queueSubscription({ unsubscribe: secondUnsubscribe });
    const resync = vi.fn();
    const watch = await openWatch(resync);

    callbacks[0](new Error('Watcher failed'), []);
    await vi.advanceTimersByTimeAsync(250);

    expect(firstUnsubscribe).toHaveBeenCalledOnce();
    expect(watcherMock.subscribe).toHaveBeenCalledOnce();

    callbacks[0](new Error('Late failure during unsubscribe'), []);
    stopped.resolve();
    await vi.waitFor(() => expect(watcherMock.subscribe).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(500);
    expect(watcherMock.subscribe).toHaveBeenCalledTimes(2);
    expect(resync).toHaveBeenCalledOnce();

    await watch.dispose();
    expect(secondUnsubscribe).toHaveBeenCalledOnce();
  });

  it('ignores errors delivered by a stale subscription callback', async () => {
    queueSubscription({ unsubscribe: vi.fn(async () => {}) });
    queueSubscription({ unsubscribe: vi.fn(async () => {}) });
    const watch = await openWatch();

    callbacks[0](new Error('Watcher failed'), []);
    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => expect(watcherMock.subscribe).toHaveBeenCalledTimes(2));

    callbacks[0](new Error('Late failure from old watcher'), []);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(watcherMock.subscribe).toHaveBeenCalledTimes(2);
    await watch.dispose();
  });

  it('retries an error reported while the replacement subscription is starting', async () => {
    const replacement = deferred<parcelWatcher.AsyncSubscription>();
    const unsubscribes = [vi.fn(async () => {}), vi.fn(async () => {}), vi.fn(async () => {})];
    queueSubscription({ unsubscribe: unsubscribes[0] });
    queueSubscription(replacement.promise);
    queueSubscription({ unsubscribe: unsubscribes[2] });
    const watch = await openWatch();

    callbacks[0](new Error('Watcher failed'), []);
    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => expect(watcherMock.subscribe).toHaveBeenCalledTimes(2));

    callbacks[1](new Error('Replacement failed immediately'), []);
    replacement.resolve({ unsubscribe: unsubscribes[1] });
    await vi.advanceTimersByTimeAsync(249);
    expect(watcherMock.subscribe).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(watcherMock.subscribe).toHaveBeenCalledTimes(3));

    expect(unsubscribes[1]).toHaveBeenCalledOnce();
    await watch.dispose();
  });

  it('retries when creating the replacement subscription fails', async () => {
    const firstUnsubscribe = vi.fn(async () => {});
    const finalUnsubscribe = vi.fn(async () => {});
    queueSubscription({ unsubscribe: firstUnsubscribe });
    watcherMock.subscribe.mockRejectedValueOnce(new Error('Replacement setup failed'));
    queueSubscription({ unsubscribe: finalUnsubscribe });
    const watch = await openWatch();

    callbacks[0](new Error('Watcher failed'), []);
    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => expect(watcherMock.subscribe).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(500);
    await vi.waitFor(() => expect(watcherMock.subscribe).toHaveBeenCalledTimes(3));

    expect(firstUnsubscribe).toHaveBeenCalledOnce();
    await watch.dispose();
    expect(finalUnsubscribe).toHaveBeenCalledOnce();
  });

  it('does not unsubscribe twice when stopping the previous subscription fails', async () => {
    const unsubscribe = vi.fn().mockRejectedValue(new Error('Failed to stop watcher'));
    queueSubscription({ unsubscribe });
    const watch = await openWatch();

    callbacks[0](new Error('Watcher failed'), []);
    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalledOnce());

    await expect(watch.dispose()).resolves.toBeUndefined();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(watcherMock.subscribe).toHaveBeenCalledOnce();
  });

  it('does not create a replacement when disposed during unsubscribe', async () => {
    const stopped = deferred();
    const unsubscribe = vi.fn(() => stopped.promise);
    queueSubscription({ unsubscribe });
    const resync = vi.fn();
    const watch = await openWatch(resync);

    callbacks[0](new Error('Watcher failed'), []);
    await vi.advanceTimersByTimeAsync(250);
    const disposed = watch.dispose();
    stopped.resolve();
    await disposed;

    expect(watcherMock.subscribe).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(resync).not.toHaveBeenCalled();
  });

  it('disposes a replacement that finishes subscribing during disposal', async () => {
    const replacement = deferred<parcelWatcher.AsyncSubscription>();
    const replacementUnsubscribe = vi.fn(async () => {});
    queueSubscription({ unsubscribe: vi.fn(async () => {}) });
    queueSubscription(replacement.promise);
    const resync = vi.fn();
    const watch = await openWatch(resync);

    callbacks[0](new Error('Watcher failed'), []);
    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => expect(watcherMock.subscribe).toHaveBeenCalledTimes(2));
    const disposed = watch.dispose();
    replacement.resolve({ unsubscribe: replacementUnsubscribe });
    await disposed;

    expect(replacementUnsubscribe).toHaveBeenCalledOnce();
    expect(watcherMock.subscribe).toHaveBeenCalledTimes(2);
    expect(resync).not.toHaveBeenCalled();
  });
});
