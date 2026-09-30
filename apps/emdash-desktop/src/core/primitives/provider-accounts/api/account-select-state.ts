import {
  sortProviderAccountsByDefault,
  type ProviderAccountSummary,
} from './provider-account-summary';

export type RequiredProviderAccountSelectState<Account extends ProviderAccountSummary> = {
  accounts: Account[];
  selectedAccount: Account | null;
  selectedAccountId: string | null;
};

/**
 * Initial selection for forms that require a concrete account. A missing choice
 * falls back to the default, then the first account. Persisted project pins use
 * resolveProviderAccount instead, so an unavailable pin never silently switches.
 */
export function createRequiredProviderAccountSelectState<Account extends ProviderAccountSummary>(
  accountId: string | null | undefined,
  accounts: Account[]
): RequiredProviderAccountSelectState<Account> {
  const sortedAccounts = sortProviderAccountsByDefault(accounts);
  const selectedAccountId = typeof accountId === 'string' && accountId.trim() ? accountId : null;
  const selectedAccount =
    (selectedAccountId
      ? sortedAccounts.find((account) => account.accountId === selectedAccountId)
      : undefined) ??
    sortedAccounts[0] ??
    null;

  return {
    accounts: sortedAccounts,
    selectedAccount,
    selectedAccountId: selectedAccount?.accountId ?? null,
  };
}
