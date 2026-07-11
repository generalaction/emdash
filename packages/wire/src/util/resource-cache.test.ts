import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '../testing';
import { acquireResourceAsResult, createResourceCache } from './resource-cache';
import { createScope, describeScope, type Scope } from './scope';

describe('createResourceCache', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shares one in-flight creation for the same key', async () => {
    const cleanup = vi.fn();
    const create = vi.fn(async (key: string, scope: Scope) => {
      scope.add(cleanup);
      return { key };
    });
    const cache = createResourceCache({ key: (key: string) => key, create });

    const first = cache.acquire('same');
    const second = cache.acquire('same');
    const firstValue = await first.ready();
    const secondValue = await second.ready();

    expect(create).toHaveBeenCalledTimes(1);
    expect(secondValue).toBe(firstValue);
    await first.release();
    expect(cleanup).not.toHaveBeenCalled();
    await second.release();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('reuses an active value during the idle window', async () => {
    vi.useFakeTimers();
    const cleanup = vi.fn();
    const create = vi.fn(async (key: string, scope: Scope) => {
      scope.add(cleanup);
      return { key, generation: create.mock.calls.length };
    });
    const cache = createResourceCache({ key: (key: string) => key, create, idleTtlMs: 50 });

    const first = cache.acquire('same');
    const firstValue = await first.ready();
    await first.release();
    await vi.advanceTimersByTimeAsync(49);

    const second = cache.acquire('same');
    const secondValue = await second.ready();

    expect(secondValue).toBe(firstValue);
    expect(cleanup).not.toHaveBeenCalled();
    await second.release();
    await vi.advanceTimersByTimeAsync(50);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('does not cache failed creation', async () => {
    const error = new Error('boom');
    const onError = vi.fn();
    const create = vi
      .fn<(key: string, scope: Scope) => Promise<string>>()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce('ok');
    const cache = createResourceCache({ key: (key: string) => key, create, onError });

    await expect(cache.acquire('same').ready()).rejects.toThrow('boom');
    await expect(cache.acquire('same').ready()).resolves.toBe('ok');

    expect(create).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith(error, 'same');
  });

  it('waits for in-flight disposal before recreating a key', async () => {
    const gate = deferred<void>();
    const create = vi.fn(async (key: string, scope: Scope) => {
      scope.add(async () => gate.promise);
      return { key, generation: create.mock.calls.length };
    });
    const cache = createResourceCache({ key: (key: string) => key, create });

    const first = cache.acquire('same');
    await first.ready();
    const release = first.release();
    await Promise.resolve();
    const second = cache.acquire('same');

    expect(create).toHaveBeenCalledTimes(1);
    gate.resolve();
    await release;
    await expect(second.ready()).resolves.toEqual({ key: 'same', generation: 2 });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('disposes entries when the parent scope is disposed', async () => {
    const cleanup = vi.fn();
    const parent = createScope({ label: 'parent' });
    const cache = createResourceCache({
      key: (key: string) => key,
      scope: parent,
      label: 'sessions',
      create: async (key: string, scope: Scope) => {
        scope.add(cleanup);
        return key;
      },
    });

    await cache.acquire('same').ready();
    expect(describeScope(parent)).toMatchObject({
      label: 'parent',
      children: [
        {
          label: 'sessions',
          labelPath: 'parent/sessions',
          children: [{ label: 'same', labelPath: 'parent/sessions/same' }],
        },
      ],
    });

    await parent.dispose();

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(cache.peek('same')).toBeUndefined();
    await expect(cache.acquire('same').ready()).rejects.toThrow('ResourceCache is disposed');
  });

  it('cancels in-flight creation when an entry is invalidated', async () => {
    const started = deferred<void>();
    const cache = createResourceCache({
      key: (key: string) => key,
      create: async (_key: string, scope: Scope) => {
        started.resolve();
        await new Promise<never>((_resolve, reject) => {
          scope.signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        });
      },
    });

    const lease = cache.acquire('same');
    await started.promise;
    const invalidate = cache.invalidate('same');

    await expect(lease.ready()).rejects.toThrow('Scope disposed');
    await invalidate;
    expect(cache.peek('same')).toBeUndefined();
  });

  it('force-closes held leases on disposal', async () => {
    const cleanup = vi.fn();
    const cache = createResourceCache({
      key: (key: string) => key,
      create: async (key: string, scope: Scope) => {
        scope.add(cleanup);
        return key;
      },
    });

    const lease = cache.acquire('same');
    await expect(lease.ready()).resolves.toBe('same');
    await cache.dispose();
    await lease.release();

    expect(cleanup).toHaveBeenCalledTimes(1);
    await expect(cache.acquire('same').ready()).rejects.toThrow('ResourceCache is disposed');
  });

  it('acquires a lease as an ok result', async () => {
    const cache = createResourceCache({
      key: (key: string) => key,
      create: async (key: string) => key,
    });

    const result = await acquireResourceAsResult(cache, 'same', isTestError);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.value).toBe('same');
    await result.data.release();
  });

  it('maps expected acquire errors to err results', async () => {
    const expected = { type: 'test-error', message: 'boom' } as const;
    const cache = createResourceCache({
      key: (key: string) => key,
      create: async () => {
        throw expected;
      },
    });

    const result = await acquireResourceAsResult(cache, 'same', isTestError);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe(expected);
  });
});

type TestError = { type: 'test-error'; message: string };

function isTestError(error: unknown): error is TestError {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { type?: unknown }).type === 'test-error'
  );
}
