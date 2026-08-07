import { describe, expect, it, vi } from 'vitest';
import { createAsyncCache } from './async-cache';

describe('createAsyncCache', () => {
  it('caches loaded values and reloads after expiry on get', async () => {
    let time = 0;
    const load = vi.fn(async (key: string) => `${key}:${time}`);
    const cache = createAsyncCache<string, string>({
      key: (key) => key,
      ttlMs: 100,
      now: () => time,
      load,
    });

    await expect(cache.get('a')).resolves.toBe('a:0');
    await expect(cache.get('a')).resolves.toBe('a:0');
    expect(load).toHaveBeenCalledTimes(1);

    time = 150;
    await expect(cache.get('a')).resolves.toBe('a:150');
    expect(load).toHaveBeenCalledTimes(2);

    await cache.dispose();
  });

  describe('peek purity', () => {
    it('returns undefined past expiry without loading', async () => {
      let time = 0;
      const load = vi.fn(async (key: string) => key.toUpperCase());
      const cache = createAsyncCache<string, string>({
        key: (key) => key,
        ttlMs: 100,
        now: () => time,
        load,
      });

      await cache.get('a');
      expect(cache.peek('a')).toBe('A');

      time = 150;
      expect(cache.peek('a')).toBeUndefined();
      expect(load).toHaveBeenCalledTimes(1);

      await cache.dispose();
    });

    it('does not bump the eviction order — peeked entries are still evicted first', async () => {
      const cache = createAsyncCache<string, string>({
        key: (key) => key,
        maxEntries: 2,
        load: async (key) => key.toUpperCase(),
      });

      cache.set('a', 'A');
      cache.set('b', 'B');

      // A genuinely side-effect-free read must not refresh 'a' in the LRU order.
      expect(cache.peek('a')).toBe('A');

      cache.set('c', 'C');

      expect(cache.peek('a')).toBeUndefined();
      expect(cache.peek('b')).toBe('B');
      expect(cache.peek('c')).toBe('C');

      await cache.dispose();
    });

    it('repeated expired peeks stay stable and get() still reloads afterwards', async () => {
      let time = 0;
      const load = vi.fn(async (key: string) => `${key}:${time}`);
      const cache = createAsyncCache<string, string>({
        key: (key) => key,
        ttlMs: 100,
        now: () => time,
        load,
      });

      await cache.get('a');
      time = 150;
      expect(cache.peek('a')).toBeUndefined();
      expect(cache.peek('a')).toBeUndefined();

      await expect(cache.get('a')).resolves.toBe('a:150');
      expect(load).toHaveBeenCalledTimes(2);

      await cache.dispose();
    });
  });
});
