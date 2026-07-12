import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '../testing';
import { createAsyncCache } from './async-cache';
import { createScope } from './scope';

describe('createAsyncCache', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shares one in-flight load for the same key', async () => {
    const gate = deferred<number>();
    const load = vi.fn(async () => gate.promise);
    const cache = createAsyncCache({ key: (key: string) => key, load });

    const first = cache.get('same');
    const second = cache.get('same');
    await Promise.resolve();

    expect(load).toHaveBeenCalledTimes(1);
    gate.resolve(42);
    await expect(first).resolves.toBe(42);
    await expect(second).resolves.toBe(42);
  });

  it('caches successful loads until invalidated', async () => {
    const load = vi.fn(async (key: string) => `${key}:${load.mock.calls.length}`);
    const cache = createAsyncCache({ key: (key: string) => key, load });

    await expect(cache.get('same')).resolves.toBe('same:1');
    await expect(cache.get('same')).resolves.toBe('same:1');
    expect(load).toHaveBeenCalledTimes(1);

    cache.invalidate('same');
    await expect(cache.get('same')).resolves.toBe('same:2');
  });

  it('expires successful loads by ttl', async () => {
    vi.useFakeTimers({ now: 100 });
    const load = vi.fn(async (key: string) => `${key}:${load.mock.calls.length}`);
    const cache = createAsyncCache({ key: (key: string) => key, ttlMs: 50, load });

    await expect(cache.get('same')).resolves.toBe('same:1');
    await vi.advanceTimersByTimeAsync(49);
    await expect(cache.get('same')).resolves.toBe('same:1');
    await vi.advanceTimersByTimeAsync(1);
    await expect(cache.get('same')).resolves.toBe('same:2');
  });

  it('does not cache failed loads', async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('ok');
    const cache = createAsyncCache({ key: (key: string) => key, load });

    await expect(cache.get('same')).rejects.toThrow('boom');
    await expect(cache.get('same')).resolves.toBe('ok');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('supports manual values and bounded eviction', async () => {
    const load = vi.fn(async (key: string) => key);
    const cache = createAsyncCache({ key: (key: string) => key, maxEntries: 2, load });

    cache.set('a', 'A');
    cache.set('b', 'B');
    expect(cache.peek('a')).toBe('A');
    cache.set('c', 'C');

    expect(cache.peek('b')).toBeUndefined();
    expect(cache.peek('a')).toBe('A');
    expect(cache.peek('c')).toBe('C');
  });

  it('cancels in-flight loads when the parent scope closes', async () => {
    const parent = createScope();
    const started = deferred<void>();
    const cache = createAsyncCache({
      key: (key: string) => key,
      scope: parent,
      load: async (_key, signal) => {
        started.resolve();
        await new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      },
    });

    const pending = cache.get('same');
    await started.promise;
    await parent.dispose('parent closed');

    await expect(pending).rejects.toThrow('parent closed');
  });
});
