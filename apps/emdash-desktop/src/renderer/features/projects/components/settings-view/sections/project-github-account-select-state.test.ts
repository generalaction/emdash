import { describe, expect, it } from 'vitest';
import type { GitHubAccountSummary } from '@shared/github';
import {
  createProjectGitHubAccountSelectState,
  NO_GITHUB_ACCOUNT,
  UNCONFIGURED_GITHUB_ACCOUNT,
} from './project-github-account-select-state';

function account(
  accountId: string,
  overrides: Partial<GitHubAccountSummary> = {}
): GitHubAccountSummary {
  return {
    accountId,
    host: accountId.split(':')[0] ?? 'github.com',
    login: accountId,
    avatarUrl: '',
    credentialSource: 'cli',
    isDefault: false,
    ...overrides,
  };
}

describe('project GitHub account select state', () => {
  it('keeps unconfigured and explicit no-account settings distinct', () => {
    expect(createProjectGitHubAccountSelectState(undefined, []).selectValue).toBe(
      UNCONFIGURED_GITHUB_ACCOUNT
    );
    expect(createProjectGitHubAccountSelectState(null, []).selectValue).toBe(NO_GITHUB_ACCOUNT);
  });

  it('selects an available GitHub account by id', () => {
    const selected = account('github.com:42');
    const state = createProjectGitHubAccountSelectState('github.com:42', [selected]);

    expect(state.selectedAccountId).toBe('github.com:42');
    expect(state.selectedAccount).toBe(selected);
    expect(state.missingAccountId).toBeNull();
    expect(state.selectValue).toBe('github.com:42');
  });

  it('detects selected accounts that are no longer available', () => {
    const state = createProjectGitHubAccountSelectState('github.com:42', [
      account('github.com:84'),
    ]);

    expect(state.selectedAccount).toBeUndefined();
    expect(state.missingAccountId).toBe('github.com:42');
    expect(state.selectValue).toBe('github.com:42');
  });

  it('sorts the default account first', () => {
    const first = account('github.com:1');
    const defaultAccount = account('github.com:2', { isDefault: true });

    expect(createProjectGitHubAccountSelectState(null, [first, defaultAccount]).accounts).toEqual([
      defaultAccount,
      first,
    ]);
  });
});
