import { parseAbsolute } from '@primitives/path/api';
import {
  createBranchErrorSchema,
  deleteBranchErrorSchema,
  fetchPrForReviewErrorSchema,
  gitCommandErrorSchema,
  gitResolutionErrorSchema,
  switchErrorSchema,
} from '@runtimes/git/api/api/errors';
import { describe, expect, it } from 'vitest';
import { gitErr } from './errors';

describe('gitErr', () => {
  it('constructs command failures accepted by the public schema', () => {
    const result = gitErr.commandFailed('command failed', 'fatal: command failed');

    expect(result).toEqual({
      success: false,
      error: {
        type: 'git_error',
        message: 'command failed',
        stderr: 'fatal: command failed',
      },
    });
    expect(gitCommandErrorSchema.parse(result.error)).toEqual(result.error);
  });

  it('constructs stale ref updates as typed Git execution failures', () => {
    const result = gitErr.staleRefUpdate(
      "cannot lock ref 'refs/remotes/origin/main': is at bbbb but expected aaaa"
    );

    expect(result).toEqual({
      success: false,
      error: {
        type: 'git_error',
        code: 'stale_ref_update',
        message: "cannot lock ref 'refs/remotes/origin/main': is at bbbb but expected aaaa",
      },
    });
    expect(gitCommandErrorSchema.parse(result.error)).toEqual(result.error);
  });

  it('constructs operation-specific not-found failures without conflating their shapes', () => {
    const pullRequest = gitErr.prNotFound(42, 'pull request not found').error;
    const branch = gitErr.branchNotFound('topic', 'branch not found').error;
    const ref = gitErr.refNotFound('missing', 'ref not found').error;

    expect(fetchPrForReviewErrorSchema.parse(pullRequest)).toEqual(pullRequest);
    expect(deleteBranchErrorSchema.parse(branch)).toEqual(branch);
    expect(switchErrorSchema.parse(ref)).toEqual(ref);
  });

  it('constructs nested operation failures accepted by the composed schema', () => {
    const fetch = gitErr.networkError('offline').error;
    const result = gitErr.fetchFailed('origin', 'main', fetch);

    expect(createBranchErrorSchema.parse(result.error)).toEqual(result.error);
  });

  it('keeps selector resolution failures distinct from Git process failures', () => {
    const path = parseAbsolute('/workspace');
    if (!path.success) throw new Error(path.error.message);
    const result = gitErr.resolutionFailed(path.data, 'not a Git checkout');

    expect(gitResolutionErrorSchema.parse(result.error)).toEqual(result.error);
    expect(gitCommandErrorSchema.parse(result.error)).toEqual(result.error);
  });
});
