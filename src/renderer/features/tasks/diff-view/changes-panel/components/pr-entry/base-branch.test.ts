import { describe, expect, it } from 'vitest';
import type { Branch } from '@shared/git';
import { resolveInitialBaseBranch, toShortBranchName } from './base-branch';

const originRemote = { name: 'origin', url: 'git@github.com:owner/repo.git' };

describe('toShortBranchName', () => {
  it('keeps exact branch names unchanged', () => {
    const branches: Branch[] = [{ type: 'local', branch: 'feature/api-cleanup' }];

    expect(toShortBranchName('feature/api-cleanup', branches)).toBe('feature/api-cleanup');
  });

  it('strips known remote prefixes from base refs', () => {
    const branches: Branch[] = [
      { type: 'remote', remote: originRemote, branch: 'main' },
      { type: 'local', branch: 'main' },
    ];

    expect(toShortBranchName('origin/main', branches)).toBe('main');
  });
});

describe('resolveInitialBaseBranch', () => {
  it('prefers the task source branch when it exists', () => {
    const branches: Branch[] = [
      { type: 'remote', remote: originRemote, branch: 'main' },
      { type: 'local', branch: 'release/v2' },
      { type: 'local', branch: 'main' },
    ];
    const defaultBranch: Branch = { type: 'local', branch: 'main' };

    expect(resolveInitialBaseBranch(branches, 'release/v2', defaultBranch)).toEqual({
      type: 'local',
      branch: 'release/v2',
    });
  });

  it('falls back to repository default branch when preferred branch is unavailable', () => {
    const branches: Branch[] = [{ type: 'remote', remote: originRemote, branch: 'main' }];
    const defaultBranch: Branch = { type: 'remote', remote: originRemote, branch: 'main' };

    expect(resolveInitialBaseBranch(branches, 'release/v2', defaultBranch)).toEqual({
      type: 'remote',
      remote: originRemote,
      branch: 'main',
    });
  });

  it('returns undefined when no preferred branch and no default branch', () => {
    const branches: Branch[] = [{ type: 'remote', remote: originRemote, branch: 'main' }];

    expect(resolveInitialBaseBranch(branches, undefined, undefined)).toBeUndefined();
  });
});
