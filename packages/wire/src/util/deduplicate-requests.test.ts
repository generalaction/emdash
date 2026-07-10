import { describe, expect, it, vi } from 'vitest';
import { deferred } from '../testing';
import { deduplicateRequests } from './deduplicate-requests';

describe('deduplicateRequests', () => {
  it('shares one in-flight execution for identical inputs', async () => {
    const gate = deferred<number>();
    const handler = vi.fn(async () => gate.promise);
    const deduped = deduplicateRequests(handler);

    const first = deduped({ id: 'same' });
    const second = deduped({ id: 'same' });

    expect(handler).toHaveBeenCalledTimes(1);
    gate.resolve(42);
    await expect(first).resolves.toBe(42);
    await expect(second).resolves.toBe(42);
  });

  it('uses stable JSON identity for object keys', async () => {
    const handler = vi.fn(async () => 'ok');
    const deduped = deduplicateRequests(handler);

    const first = deduped({ a: 1, b: 2 });
    const second = deduped({ b: 2, a: 1 });

    await expect(first).resolves.toBe('ok');
    await expect(second).resolves.toBe('ok');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not deduplicate different inputs', async () => {
    const handler = vi.fn(async (input: { id: string }) => input.id);
    const deduped = deduplicateRequests(handler);

    await expect(Promise.all([deduped({ id: 'a' }), deduped({ id: 'b' })])).resolves.toEqual([
      'a',
      'b',
    ]);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('does not cache rejections', async () => {
    const handler = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('ok');
    const deduped = deduplicateRequests(handler);

    await expect(deduped({ id: 'same' })).rejects.toThrow('boom');
    await expect(deduped({ id: 'same' })).resolves.toBe('ok');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('supports custom keys', async () => {
    const handler = vi.fn(async (input: { id: string; version: number }) => input.id);
    const deduped = deduplicateRequests(handler, { key: (input) => input.id });

    await expect(
      Promise.all([deduped({ id: 'same', version: 1 }), deduped({ id: 'same', version: 2 })])
    ).resolves.toEqual(['same', 'same']);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('re-executes after a completed in-flight request clears', async () => {
    const handler = vi.fn(async (input: { id: string }) => input.id);
    const deduped = deduplicateRequests(handler);

    await expect(deduped({ id: 'same' })).resolves.toBe('same');
    await expect(deduped({ id: 'same' })).resolves.toBe('same');
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
