import { ok } from '@emdash/shared';
import { describe, expect, it } from 'vitest';
import { withMappedMutationErrors } from './mutation-error';

describe('withMappedMutationErrors', () => {
  it('maps expected thrown errors to mutation results', async () => {
    const result = await withMappedMutationErrors(
      () => {
        throw new ExpectedError('typed');
      },
      (error) => (error instanceof ExpectedError ? { type: error.message } : undefined)
    );

    expect(result).toEqual({ success: false, error: { type: 'typed' } });
  });

  it('passes successful results through', async () => {
    await expect(
      withMappedMutationErrors(
        () => ok('done'),
        () => undefined
      )
    ).resolves.toEqual(ok('done'));
  });

  it('rethrows unexpected errors', async () => {
    const unexpected = new Error('unexpected');

    await expect(
      withMappedMutationErrors(
        () => {
          throw unexpected;
        },
        () => undefined
      )
    ).rejects.toBe(unexpected);
  });
});

class ExpectedError extends Error {}
