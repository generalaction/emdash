import { describe, expect, it } from 'vitest';
import { resolveTaskBranchName } from './resolveTaskBranchName';

describe('resolveTaskBranchName', () => {
  it('uses Linear branchName as-is when available', () => {
    const branchName = resolveTaskBranchName({
      rawBranch: 'linear-issue-branch-name-creation',
      branchPrefix: 'emdash',
      suffix: 'abc12',
      linkedIssue: {
        provider: 'linear',
        url: 'https://linear.app/general-action/issue/GEN-626',
        title: 'Linear issue branch name creation',
        identifier: 'GEN-626',
        branchName: 'jona/gen-626-linear-issue-branch-name-creation',
      },
    });

    expect(branchName).toBe('jona/gen-626-linear-issue-branch-name-creation');
  });

  it('falls back to the existing prefixed and suffixed format when Linear branchName is absent', () => {
    const branchName = resolveTaskBranchName({
      rawBranch: 'linear-issue-branch-name-creation',
      branchPrefix: 'emdash',
      suffix: 'abc12',
      linkedIssue: {
        provider: 'linear',
        url: 'https://linear.app/general-action/issue/GEN-626',
        title: 'Linear issue branch name creation',
        identifier: 'GEN-626',
      },
    });

    expect(branchName).toBe('emdash/linear-issue-branch-name-creation-abc12');
  });

  it('keeps the existing format for non-Linear issues', () => {
    const branchName = resolveTaskBranchName({
      rawBranch: 'bugfix-login',
      branchPrefix: 'emdash',
      suffix: 'xyz99',
      linkedIssue: {
        provider: 'jira',
        url: 'https://example.atlassian.net/browse/APP-42',
        title: 'Fix login bug',
        identifier: 'APP-42',
        branchName: 'someone/app-42-fix-login-bug',
      },
    });

    expect(branchName).toBe('emdash/bugfix-login-xyz99');
  });
});
