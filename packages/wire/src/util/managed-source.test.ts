import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '../testing';
import { acquireAsResult, createManagedSource } from './managed-source';
import { createScope, describeScope, type Scope } from './scope';

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

  it('disposes entries when the parent scope is disposed', async () => {
    const cleanup = vi.fn();
    const parent = createScope({ label: 'parent' });
    const source = createManagedSource({
      key: (key: string) => key,
      scope: parent,
      label: 'sessions',
      create: async (key: string, scope: Scope) => {
        scope.add(cleanup);
        return key;
      },
    });

    await source.acquire('same').ready();
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
    expect(source.peek('same')).toBeUndefined();
    await expect(source.acquire('same').ready()).rejects.toThrow('ManagedSource is disposed');
  });

  it('cancels in-flight creation when the parent scope is disposed', async () => {
    const parent = createScope({ label: 'parent' });
    const started = deferred<void>();
    const source = createManagedSource({
      key: (key: string) => key,
      scope: parent,
      create: async (_key: string, scope: Scope) => {
        started.resolve();
        await new Promise<never>((_resolve, reject) => {
          scope.signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        });
      },
    });

    const lease = source.acquire('same');
    await started.promise;
    const dispose = parent.dispose('parent closed');

    await expect(lease.ready()).rejects.toThrow('parent closed');
    await dispose;
    expect(source.peek('same')).toBeUndefined();
  });

  it('handles explicit and parent disposal idempotently', async () => {
    const cleanup = vi.fn();
    const parent = createScope({ label: 'parent' });
    const source = createManagedSource({
      key: (key: string) => key,
      scope: parent,
      create: async (key: string, scope: Scope) => {
        scope.add(cleanup);
        return key;
      },
    });

    await source.acquire('same').ready();
    await source.dispose();
    await parent.dispose();

    expect(cleanup).toHaveBeenCalledTimes(1);
    await expect(source.acquire('same').ready()).rejects.toThrow('ManagedSource is disposed');
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

  it('cancels in-flight creation when an entry is invalidated', async () => {
    const started = deferred<void>();
    const source = createManagedSource({
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

    const lease = source.acquire('same');
    await started.promise;
    const invalidate = source.invalidate('same');

    await expect(lease.ready()).rejects.toThrow('Scope disposed');
    await invalidate;
    expect(source.peek('same')).toBeUndefined();
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

  it('acquires a lease as an ok result', async () => {
    const source = createManagedSource({
      key: (key: string) => key,
      create: async (key: string) => key,
    });

    const result = await acquireAsResult(source, 'same', isTestError);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.value).toBe('same');
    await result.data.release();
  });

  it('maps expected acquire errors to err results', async () => {
    const expected = { type: 'test-error', message: 'boom' } as const;
    const source = createManagedSource({
      key: (key: string) => key,
      create: async () => {
        throw expected;
      },
    });

    const result = await acquireAsResult(source, 'same', isTestError);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe(expected);
  });

  it('rethrows unexpected acquire errors', async () => {
    const source = createManagedSource({
      key: (key: string) => key,
      create: async () => {
        throw new Error('boom');
      },
    });

    await expect(acquireAsResult(source, 'same', isTestError)).rejects.toThrow('boom');
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

type TestError = { type: 'test-error'; message: string };

function isTestError(error: unknown): error is TestError {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { type?: unknown }).type === 'test-error'
  );
}
