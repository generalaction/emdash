import { describe, expect, it } from 'vitest';
import type { GitHubAccountSummary } from '@shared/github';
import {
  createRequiredGitHubAccountSelectState,
  sortGitHubAccountsByDefault,
} from './github-account-select-model';

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

describe('GitHub account select model', () => {
  it('sorts the default account first', () => {
    const first = account('github.com:1');
    const defaultAccount = account('github.com:2', { isDefault: true });

    expect(sortGitHubAccountsByDefault([first, defaultAccount])).toEqual([defaultAccount, first]);
  });

  it('selects the requested account when it is available', () => {
    const first = account('github.com:1');
    const selected = account('github.com:2', { isDefault: true });

    const state = createRequiredGitHubAccountSelectState('github.com:1', [first, selected]);

    expect(state.selectedAccount).toBe(first);
    expect(state.selectedAccountId).toBe('github.com:1');
  });

  it('falls back to the default account when the requested account is unavailable', () => {
    const first = account('github.com:1');
    const defaultAccount = account('github.com:2', { isDefault: true });

    const state = createRequiredGitHubAccountSelectState('github.com:missing', [
      first,
      defaultAccount,
    ]);

    expect(state.selectedAccount).toBe(defaultAccount);
    expect(state.selectedAccountId).toBe('github.com:2');
  });

  it('has no selected account when there are no accounts', () => {
    const state = createRequiredGitHubAccountSelectState(undefined, []);

    expect(state.selectedAccount).toBeNull();
    expect(state.selectedAccountId).toBeNull();
  });
});
