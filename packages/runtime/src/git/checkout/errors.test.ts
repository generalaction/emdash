import { ExecError } from '@emdash/core/exec';
import { describe, expect, it } from 'vitest';
import { checkoutFailures } from './errors';

function execError(stderr: string, exitCode = 128): ExecError {
  return new ExecError('git', ['test'], exitCode, '', stderr);
}

describe('checkout failures', () => {
  it('maps checkout operation failures to their declared variants', () => {
    expect(
      checkoutFailures.commit(execError('nothing to commit, working tree clean'))
    ).toMatchObject({
      success: false,
      error: { type: 'nothing_to_commit' },
    });
    expect(
      checkoutFailures.switch(
        execError('error: pathspec missing did not match any file'),
        'missing'
      )
    ).toMatchObject({ success: false, error: { type: 'not_found', ref: 'missing' } });
    expect(
      checkoutFailures.merge(execError('CONFLICT (content): merge conflict'), ['file'])
    ).toMatchObject({
      success: false,
      error: { type: 'conflict', conflictedFiles: ['file'] },
    });
    expect(checkoutFailures.pull(execError('fatal: no upstream configured'))).toMatchObject({
      success: false,
      error: { type: 'no_upstream' },
    });
  });

  it('rethrows failures that did not come from Git execution', () => {
    const bug = new TypeError('classifier bug');
    expect(() => checkoutFailures.commit(bug)).toThrow(bug);
  });
});
