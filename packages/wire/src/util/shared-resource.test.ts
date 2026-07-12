import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '../testing';
import { createScope, type Scope } from './scope';
import { createSharedResource } from './shared-resource';

describe('createSharedResource', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shares one in-flight creation', async () => {
    const create = vi.fn(async () => ({ id: create.mock.calls.length }));
    const resource = createSharedResource({ create });

    const first = resource.acquire();
    const second = resource.acquire();
    const firstValue = await first.ready();
    const secondValue = await second.ready();

    expect(create).toHaveBeenCalledTimes(1);
    expect(secondValue).toBe(firstValue);
    await first.release();
    await second.release();
  });

  it('retries after failed creation', async () => {
    const create = vi
      .fn<(scope: Scope) => Promise<string>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('ok');
    const resource = createSharedResource({ create });

    await expect(resource.acquire().ready()).rejects.toThrow('boom');
    await expect(resource.acquire().ready()).resolves.toBe('ok');
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('disposes through the parent scope', async () => {
    const cleanup = vi.fn();
    const parent = createScope();
    const resource = createSharedResource({
      scope: parent,
      create: async (scope) => {
        scope.add(cleanup);
        return 'value';
      },
    });

    await resource.acquire().ready();
    await parent.dispose();

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(resource.peek()).toBeUndefined();
  });

  it('cancels in-flight creation when invalidated', async () => {
    const started = deferred<void>();
    const resource = createSharedResource({
      create: async (scope) => {
        started.resolve();
        await new Promise<never>((_resolve, reject) => {
          scope.signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        });
      },
    });

    const lease = resource.acquire();
    await started.promise;
    const invalidate = resource.invalidate();

    await expect(lease.ready()).rejects.toThrow('Scope disposed');
    await invalidate;
  });
});
