import type { GitHubAccountSummary } from '@shared/github';
import { sortGitHubAccountsByDefault } from '../../github-account-select-model';

export const NO_GITHUB_ACCOUNT = '__no_github_account__';
export const UNCONFIGURED_GITHUB_ACCOUNT = '__unconfigured_github_account__';

export type ProjectGitHubAccountSelectState = {
  accounts: GitHubAccountSummary[];
  missingAccountId: string | null;
  selectedAccount: GitHubAccountSummary | undefined;
  selectedAccountId: string | null;
  selectValue: string;
};

export function createProjectGitHubAccountSelectState(
  githubAccountId: string | null | undefined,
  accounts: GitHubAccountSummary[]
): ProjectGitHubAccountSelectState {
  const selectedAccountId =
    typeof githubAccountId === 'string' && githubAccountId.trim() ? githubAccountId : null;
  const sortedAccounts = sortGitHubAccountsByDefault(accounts);
  const selectedAccount = accounts.find((account) => account.accountId === selectedAccountId);
  const missingAccountId = selectedAccountId && !selectedAccount ? selectedAccountId : null;
  const selectValue =
    githubAccountId === undefined
      ? UNCONFIGURED_GITHUB_ACCOUNT
      : (selectedAccountId ?? NO_GITHUB_ACCOUNT);

  return {
    accounts: sortedAccounts,
    missingAccountId,
    selectedAccount,
    selectedAccountId,
    selectValue,
  };
}
