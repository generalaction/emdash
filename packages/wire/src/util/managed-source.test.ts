import { describe, expect, it, vi } from 'vitest';
import { deferred } from '../testing';
import { createManagedSource } from './managed-source';
import type { Scope } from './scope';

describe('createManagedSource', () => {
  it('delegates basic resource ownership to ResourceCache', async () => {
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

  it('forwards creation context to the first acquire for a key', async () => {
    const create = vi.fn(
      async (key: string, context: { cwd: string }, _scope: Scope) => `${key}:${context.cwd}`
    );
    const source = createManagedSource<string, string, { cwd: string }>({
      key: (key) => key,
      create,
    });

    const lease = source.acquire('same', { cwd: '/tmp/one' });

    await expect(lease.ready()).resolves.toBe('same:/tmp/one');
    expect(create).toHaveBeenCalledWith('same', { cwd: '/tmp/one' }, expect.anything());
    await lease.release();
  });

  it('uses the first context for concurrent acquires sharing one in-flight creation', async () => {
    const gate = deferred<string>();
    const create = vi.fn(
      async (_key: string, context: { cwd: string }, _scope: Scope) =>
        `${await gate.promise}:${context.cwd}`
    );
    const source = createManagedSource<string, string, { cwd: string }>({
      key: (key) => key,
      create,
    });

    const first = source.acquire('same', { cwd: '/tmp/one' });
    const second = source.acquire('same', { cwd: '/tmp/two' });
    gate.resolve('ready');

    await expect(first.ready()).resolves.toBe('ready:/tmp/one');
    await expect(second.ready()).resolves.toBe('ready:/tmp/one');
    expect(create).toHaveBeenCalledTimes(1);
    await first.release();
    await second.release();
  });

  it('retries failed creation with a later context', async () => {
    const create = vi
      .fn<(key: string, context: { cwd: string }, scope: Scope) => Promise<string>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockImplementationOnce(async (_key, context) => context.cwd);
    const source = createManagedSource<string, string, { cwd: string }>({
      key: (key) => key,
      create,
    });

    await expect(source.acquire('same', { cwd: '/tmp/one' }).ready()).rejects.toThrow('boom');
    await expect(source.acquire('same', { cwd: '/tmp/two' }).ready()).resolves.toBe('/tmp/two');
    expect(create).toHaveBeenCalledTimes(2);
  });
});
