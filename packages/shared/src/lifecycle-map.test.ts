import { describe, expect, it, vi } from 'vitest';
import { LifecycleMap } from './lifecycle-map';
import { err, ok } from './result';

describe('LifecycleMap teardown retention', () => {
  it('retains the active value and suppresses postTeardown for a failed result', async () => {
    const postTeardown = vi.fn();
    const lifecycle = new LifecycleMap<string, Error, Error>({ postTeardown });
    await lifecycle.provision('resource-1', async () => ok('value'));
    const failure = new Error('cleanup failed');

    await expect(
      lifecycle.teardown('resource-1', async () => err(failure), { retainOnFailure: true })
    ).resolves.toEqual({ success: false, error: failure });

    expect(lifecycle.get('resource-1')).toBe('value');
    expect(postTeardown).not.toHaveBeenCalled();
    expect(lifecycle.teardownStatus('resource-1')).toEqual({ status: 'error', error: failure });
  });

  it('retains the active value and suppresses postTeardown when teardown throws', async () => {
    const postTeardown = vi.fn();
    const lifecycle = new LifecycleMap<string, Error, Error>({ postTeardown });
    await lifecycle.provision('resource-1', async () => ok('value'));

    await expect(
      lifecycle.teardown(
        'resource-1',
        async () => {
          throw new Error('cleanup crashed');
        },
        { retainOnFailure: true }
      )
    ).rejects.toThrow('cleanup crashed');

    expect(lifecycle.get('resource-1')).toBe('value');
    expect(postTeardown).not.toHaveBeenCalled();
    expect(lifecycle.teardownStatus('resource-1')).toEqual({ status: 'not-started' });
  });

  it('allows retained teardown to retry and only publishes the successful teardown', async () => {
    const postTeardown = vi.fn();
    const lifecycle = new LifecycleMap<string, Error, Error>({ postTeardown });
    await lifecycle.provision('resource-1', async () => ok('value'));
    await lifecycle.teardown('resource-1', async () => err(new Error('cleanup failed')), {
      retainOnFailure: true,
    });

    await expect(
      lifecycle.teardown('resource-1', async () => ok(), { retainOnFailure: true })
    ).resolves.toEqual({ success: true, data: undefined });

    expect(lifecycle.get('resource-1')).toBeUndefined();
    expect(postTeardown).toHaveBeenCalledTimes(1);
    expect(postTeardown).toHaveBeenCalledWith('resource-1', 'value');
    expect(lifecycle.teardownStatus('resource-1')).toEqual({ status: 'not-started' });
  });

  it('preserves the existing remove-on-failure default', async () => {
    const postTeardown = vi.fn();
    const lifecycle = new LifecycleMap<string, Error, Error>({ postTeardown });
    await lifecycle.provision('resource-1', async () => ok('value'));

    await lifecycle.teardown('resource-1', async () => err(new Error('cleanup failed')));

    expect(lifecycle.get('resource-1')).toBeUndefined();
    expect(postTeardown).toHaveBeenCalledTimes(1);
  });
});
