import { describe, expect, it } from 'vitest';
import {
  classifyCloneRepositoryError,
  classifyFetchError,
  classifyFetchPrForReviewError,
  classifyPullError,
  classifyPushError,
} from './errors';

describe('git error classifiers', () => {
  it('classifies prompt-disabled credential failures as auth_required', () => {
    const error = {
      stderr: 'fatal: could not read Username for https://github.com: terminal prompts disabled',
    };

    expect(classifyCloneRepositoryError(error, '/tmp/repo')).toMatchObject({
      type: 'auth_required',
    });
    expect(classifyFetchError(error, 'origin')).toMatchObject({ type: 'auth_required' });
    expect(classifyPushError(error)).toMatchObject({ type: 'auth_required' });
    expect(classifyPullError(error)).toMatchObject({ type: 'auth_required' });
    expect(classifyFetchPrForReviewError(error, 123)).toMatchObject({
      type: 'auth_required',
    });
  });

  it('classifies SSH public-key failures as auth_required', () => {
    expect(
      classifyFetchError({ stderr: 'git@github.com: Permission denied (publickey).' }, 'origin')
    ).toMatchObject({ type: 'auth_required' });
  });

  it('classifies HTTP 401 and 403 failures as auth_required', () => {
    expect(
      classifyPushError({
        stderr: 'fatal: unable to access url: The requested URL returned error: 401',
      })
    ).toMatchObject({ type: 'auth_required' });
    expect(
      classifyPushError({
        stderr: 'fatal: unable to access url: The requested URL returned error: 403',
      })
    ).toMatchObject({ type: 'auth_required' });
  });
});
