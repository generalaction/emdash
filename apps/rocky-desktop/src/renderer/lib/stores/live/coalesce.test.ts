import { describe, expect, it, vi } from 'vitest';
import { coalesce } from './coalesce';

describe('coalesce', () => {
  it('shares a single in-flight promise across concurrent callers', async () => {
    let resolve!: (value: number) => void;
    const producer = vi.fn(
      () =>
        new Promise<number>((res) => {
          resolve = res;
        })
    );
    const fetch = coalesce(producer);

    const a = fetch();
    const b = fetch();
    expect(producer).toHaveBeenCalledOnce();
    expect(a).toBe(b);

    resolve(7);
    await expect(a).resolves.toBe(7);
    await expect(b).resolves.toBe(7);
  });

  it('starts a fresh call once the previous one settled', async () => {
    const producer = vi.fn(async () => 1);
    const fetch = coalesce(producer);

    await fetch();
    await fetch();
    expect(producer).toHaveBeenCalledTimes(2);
  });

  it('clears the in-flight promise on rejection', async () => {
    const producer = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok');
    const fetch = coalesce(producer);

    await expect(fetch()).rejects.toThrow('boom');
    await expect(fetch()).resolves.toBe('ok');
    expect(producer).toHaveBeenCalledTimes(2);
  });
});
