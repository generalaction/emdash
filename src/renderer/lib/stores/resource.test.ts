import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Resource } from './resource';

function deferred<T>() {
  let resolve: (value: T) => void;
  let reject: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve: resolve!, reject: reject! };
}

describe('Resource event reload strategy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs a trailing reload when maxWait fires during an in-flight load', async () => {
    let handler: (() => void) | undefined;
    const firstLoad = deferred<number>();
    const secondLoad = deferred<number>();
    const fetch = vi
      .fn<() => Promise<number>>()
      .mockReturnValueOnce(firstLoad.promise)
      .mockReturnValueOnce(secondLoad.promise);

    const resource = new Resource<number, void>(fetch, [
      {
        kind: 'event',
        subscribe: (eventHandler) => {
          handler = eventHandler;
          return () => {};
        },
        onEvent: 'reload',
        debounceMs: 50,
        maxWaitMs: 100,
      },
    ]);

    resource.start();
    handler?.();

    await vi.advanceTimersByTimeAsync(40);
    handler?.();
    await vi.advanceTimersByTimeAsync(40);
    handler?.();
    await vi.advanceTimersByTimeAsync(20);

    expect(fetch).toHaveBeenCalledTimes(1);

    firstLoad.resolve(1);
    await firstLoad.promise;
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    secondLoad.resolve(2);
    await vi.waitFor(() => {
      expect(resource.data).toBe(2);
    });
  });
});
