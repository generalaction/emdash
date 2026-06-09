import type { GitHubAccountSummary } from '@shared/github';

export type RequiredGitHubAccountSelectState = {
  accounts: GitHubAccountSummary[];
  selectedAccount: GitHubAccountSummary | null;
  selectedAccountId: string | null;
};

export function sortGitHubAccountsByDefault(
  accounts: GitHubAccountSummary[]
): GitHubAccountSummary[] {
  return [...accounts].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}

export function createRequiredGitHubAccountSelectState(
  accountId: string | null | undefined,
  accounts: GitHubAccountSummary[]
): RequiredGitHubAccountSelectState {
  const sortedAccounts = sortGitHubAccountsByDefault(accounts);
  const selectedAccountId = typeof accountId === 'string' && accountId.trim() ? accountId : null;
  const selectedAccount =
    (selectedAccountId
      ? sortedAccounts.find((account) => account.accountId === selectedAccountId)
      : undefined) ??
    sortedAccounts.find((account) => account.isDefault) ??
    sortedAccounts[0] ??
    null;

  return {
    accounts: sortedAccounts,
    selectedAccount,
    selectedAccountId: selectedAccount?.accountId ?? null,
  };
}
