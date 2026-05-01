import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TTLCache } from './ttl-cache';

const TTL = 1000;

describe('TTLCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls fetch on the first get() and returns the value', async () => {
    const cache = new TTLCache<string>(TTL);
    const fetch = vi.fn().mockResolvedValue('hello');

    const result = await cache.get(fetch);

    expect(result).toBe('hello');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('returns the cached value on subsequent calls without re-fetching', async () => {
    const cache = new TTLCache<string>(TTL);
    const fetch = vi.fn().mockResolvedValue('hello');

    await cache.get(fetch);
    const result = await cache.get(fetch);

    expect(result).toBe('hello');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('shares a single in-flight promise across concurrent calls', async () => {
    const cache = new TTLCache<string>(TTL);
    let resolve!: (v: string) => void;
    const pending = new Promise<string>((res) => {
      resolve = res;
    });
    const fetch = vi.fn().mockReturnValue(pending);

    const p1 = cache.get(fetch);
    const p2 = cache.get(fetch);
    resolve('shared');

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toBe('shared');
    expect(r2).toBe('shared');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('re-fetches after the TTL has expired', async () => {
    const cache = new TTLCache<string>(TTL);
    const fetch = vi.fn().mockResolvedValue('value');

    await cache.get(fetch);
    vi.advanceTimersByTime(TTL + 1);
    await cache.get(fetch);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not re-fetch before the TTL has expired', async () => {
    const cache = new TTLCache<string>(TTL);
    const fetch = vi.fn().mockResolvedValue('value');

    await cache.get(fetch);
    vi.advanceTimersByTime(TTL - 1);
    await cache.get(fetch);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('invalidate() forces re-fetch on the next get()', async () => {
    const cache = new TTLCache<string>(TTL);
    const fetch = vi.fn().mockResolvedValue('value');

    await cache.get(fetch);
    cache.invalidate();
    await cache.get(fetch);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not populate the cache when fetch throws, and retries on the next call', async () => {
    const cache = new TTLCache<string>(TTL);
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient failure'))
      .mockResolvedValue('recovered');

    await expect(cache.get(fetch)).rejects.toThrow('transient failure');
    const result = await cache.get(fetch);

    expect(result).toBe('recovered');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
