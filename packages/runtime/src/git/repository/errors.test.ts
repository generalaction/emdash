import { ExecError } from '@emdash/core/exec';
import { describe, expect, it } from 'vitest';
import { hostPath } from '../testing/paths';
import { repositoryFailures } from './errors';

function execError(stderr: string, exitCode = 128): ExecError {
  return new ExecError('git', ['test'], exitCode, '', stderr);
}

describe('repository failures', () => {
  it('maps repository operation failures to their declared variants', () => {
    expect(
      repositoryFailures.clone(
        execError("fatal: destination path 'repo' already exists and is not an empty directory."),
        hostPath('/tmp/repo')
      )
    ).toMatchObject({
      success: false,
      error: { type: 'target_exists', path: hostPath('/tmp/repo') },
    });

    expect(
      repositoryFailures.fetch(
        execError('fatal: unable to access: Could not resolve host'),
        'origin'
      )
    ).toMatchObject({ success: false, error: { type: 'network_error' } });

    expect(
      repositoryFailures.fetchPrForReview(
        execError("fatal: couldn't find remote ref refs/pull/42/head"),
        42
      )
    ).toMatchObject({ success: false, error: { type: 'not_found', prNumber: 42 } });
  });

  it('rethrows failures that did not come from Git execution', () => {
    const bug = new TypeError('classifier bug');
    expect(() => repositoryFailures.fetch(bug, 'origin')).toThrow(bug);
  });
});
