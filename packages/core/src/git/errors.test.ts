import { describe, expect, it } from 'vitest';
import { ExecError } from '../exec';
import {
  classifyCloneRepositoryError,
  classifyFetchError,
  classifyFetchPrForReviewError,
  classifyPullError,
  classifyPushError,
  isMissingBlobError,
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

  it('distinguishes missing blobs from other command failures', () => {
    const error = (stderr: string, exitCode = 128) =>
      new ExecError('git', ['cat-file', 'blob', 'HEAD:file.txt'], exitCode, '', stderr);

    expect(isMissingBlobError(error("fatal: path 'file.txt' does not exist in 'HEAD'"))).toBe(true);
    expect(isMissingBlobError(error("fatal: invalid object name 'missing'."))).toBe(true);
    expect(isMissingBlobError(error('fatal: Not a valid object name HEAD:file.txt'))).toBe(true);
    expect(isMissingBlobError(error('fatal: permission denied'))).toBe(false);
    expect(isMissingBlobError(error("fatal: path 'file.txt' does not exist in 'HEAD'", 1))).toBe(
      false
    );
    expect(isMissingBlobError(new TypeError('executor bug'))).toBe(false);
  });
});
