import { ok } from '@emdash/shared';
import { deferred } from '@emdash/shared/testing';
import { describe, expect, it, vi } from 'vitest';
import {
  createDependencyManagerResolver,
  ensureAgentDependenciesProbed,
} from './dependency-managers';

it('shares overlapping explicit refreshes and allows a later retry after failure', async () => {
  const first = deferred<never>();
  const mutate = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(ok({}));
  const manager = { snapshot: { mutate } } as never;
  const one = ensureAgentDependenciesProbed(manager);
  const two = ensureAgentDependenciesProbed(manager);
  expect(one).toBe(two);
  expect(mutate).toHaveBeenCalledOnce();
  const assertion = expect(one).rejects.toThrow('probe failed');
  first.reject(new Error('probe failed'));
  await assertion;
  await ensureAgentDependenciesProbed(manager);
  expect(mutate).toHaveBeenCalledTimes(2);
});

describe('getDependencyManager', () => {
  it('returns a typed host-unavailable error for remote dependencies', async () => {
    const getDependencyManager = createDependencyManagerResolver({} as never);
    await expect(getDependencyManager('ssh-1')).resolves.toEqual({
      success: false,
      error: {
        type: 'host-unavailable',
        host: { type: 'remote', id: 'ssh-1' },
        reason: 'runtime-unavailable',
        message: 'Remote host dependencies require the workspace server.',
      },
    });
  });
});
