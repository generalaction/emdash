import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '../testing';
import { createManagedSource } from './managed-source';
import type { Scope } from './scope';

describe('createManagedSource', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shares one in-flight creation for the same key', async () => {
    const cleanup = vi.fn();
    const create = vi.fn(async (key: string, scope: Scope) => {
      scope.add(cleanup);
      return { key };
    });
    const source = createManagedSource({ key: (key: string) => key, create });

    const first = source.acquire('same');
    const second = source.acquire('same');
    const firstValue = await first.ready();
    const secondValue = await second.ready();

    expect(create).toHaveBeenCalledTimes(1);
    expect(secondValue).toBe(firstValue);
    await first.release();
    expect(cleanup).not.toHaveBeenCalled();
    await second.release();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('reuses an active value during the grace window', async () => {
    vi.useFakeTimers();
    const cleanup = vi.fn();
    const create = vi.fn(async (key: string, scope: Scope) => {
      scope.add(cleanup);
      return { key, generation: create.mock.calls.length };
    });
    const source = createManagedSource({ key: (key: string) => key, create, graceMs: 50 });

    const first = source.acquire('same');
    const firstValue = await first.ready();
    await first.release();
    await vi.advanceTimersByTimeAsync(49);

    const second = source.acquire('same');
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
    const source = createManagedSource({ key: (key: string) => key, create, onError });

    await expect(source.acquire('same').ready()).rejects.toThrow('boom');
    await expect(source.acquire('same').ready()).resolves.toBe('ok');

    expect(create).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith(error, 'same');
  });

  it('waits for in-flight disposal before recreating a key', async () => {
    const gate = deferred<void>();
    const create = vi.fn(async (key: string, scope: Scope) => {
      scope.add(async () => gate.promise);
      return { key, generation: create.mock.calls.length };
    });
    const source = createManagedSource({ key: (key: string) => key, create });

    const first = source.acquire('same');
    await first.ready();
    const release = first.release();
    await Promise.resolve();
    const second = source.acquire('same');

    expect(create).toHaveBeenCalledTimes(1);
    gate.resolve();
    await release;
    await expect(second.ready()).resolves.toEqual({ key: 'same', generation: 2 });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('force-disposes all active and grace-period entries', async () => {
    vi.useFakeTimers();
    const cleanup = vi.fn();
    const source = createManagedSource({
      key: (key: string) => key,
      graceMs: 100,
      create: async (key: string, scope: Scope) => {
        scope.add(cleanup);
        return key;
      },
    });

    const lease = source.acquire('same');
    await lease.ready();
    await lease.release();
    await source.dispose();
    await vi.advanceTimersByTimeAsync(100);

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('invalidates an active entry regardless of ref count', async () => {
    const cleanup = vi.fn();
    const create = vi.fn(async (key: string, scope: Scope) => {
      scope.add(cleanup);
      return { key, generation: create.mock.calls.length };
    });
    const source = createManagedSource({ key: (key: string) => key, create });

    const first = source.acquire('same');
    const firstValue = await first.ready();
    await source.invalidate('same');

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(source.peek('same')).toBeUndefined();

    const second = source.acquire('same');
    await expect(second.ready()).resolves.toEqual({ key: 'same', generation: 2 });
    expect(source.peek('same')).not.toBe(firstValue);
    await first.release();
    await second.release();
  });

  it('invalidates a grace-period entry immediately', async () => {
    vi.useFakeTimers();
    const cleanup = vi.fn();
    const source = createManagedSource({
      key: (key: string) => key,
      graceMs: 100,
      create: async (key: string, scope: Scope) => {
        scope.add(cleanup);
        return key;
      },
    });

    const lease = source.acquire('same');
    await lease.ready();
    await lease.release();
    await source.invalidate('same');
    await vi.advanceTimersByTimeAsync(100);

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(source.peek('same')).toBeUndefined();
  });

  it('rejects new acquires after disposal', async () => {
    const source = createManagedSource({
      key: (key: string) => key,
      create: async (key: string) => key,
    });

    await source.dispose();

    await expect(source.acquire('same').ready()).rejects.toThrow('ManagedSource is disposed');
  });
});
