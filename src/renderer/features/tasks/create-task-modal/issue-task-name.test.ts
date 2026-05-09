import { describe, expect, it } from 'vitest';
import { getIssueTaskName } from './issue-task-name';

describe('getIssueTaskName', () => {
  it('normalizes a Linear branch name into a task name', () => {
    expect(
      getIssueTaskName({
        provider: 'linear',
        url: 'https://linear.app/general-action/issue/GEN-626',
        title: 'Linear issue branch name creation',
        identifier: 'GEN-626',
        branchName: 'jona/gen-626-linear-issue-branch-name-creation',
      })
    ).toBe('jona-gen-626-linear-issue-branch-name-creation');
  });

  it('returns null for non-Linear issues', () => {
    expect(
      getIssueTaskName({
        provider: 'jira',
        url: 'https://example.atlassian.net/browse/APP-42',
        title: 'Fix login bug',
        identifier: 'APP-42',
        branchName: 'jona/app-42-fix-login-bug',
      })
    ).toBeNull();
  });

  it('returns null when Linear did not provide a branch name', () => {
    expect(
      getIssueTaskName({
        provider: 'linear',
        url: 'https://linear.app/general-action/issue/GEN-626',
        title: 'Linear issue branch name creation',
        identifier: 'GEN-626',
      })
    ).toBeNull();
  });

  it('applies existing task-name length limits', () => {
    expect(
      getIssueTaskName({
        provider: 'linear',
        url: 'https://linear.app/general-action/issue/GEN-626',
        title: 'Linear issue branch name creation',
        identifier: 'GEN-626',
        branchName:
          'jona/gen-626-a-very-long-linear-issue-branch-name-that-should-be-truncated-for-task-name-display',
      })
    ).toHaveLength(64);
  });
});
