import { describe, expect, it, vi } from 'vitest';
import { acquireResourceAsResult, createResourceCache } from './resource-cache';
import type { Scope } from './scope';

describe('createResourceCache', () => {
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
