import {
  queryOptions,
  useQuery,
  type QueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  ProviderAccountSummary,
  ProviderAccountsByProvider,
} from '@core/primitives/provider-accounts/api';
import { getIntegrationsClient } from './client';

export const PROVIDER_ACCOUNTS_QUERY_KEY = ['integrations:accounts'] as const;
export const ISSUE_CONNECTION_STATUS_QUERY_KEY = ['issues:connection-status'] as const;

export function providerAccountsQueryOptions() {
  return queryOptions({
    queryKey: PROVIDER_ACCOUNTS_QUERY_KEY,
    queryFn: async (): Promise<ProviderAccountsByProvider> =>
      (await getIntegrationsClient()).listAccounts(undefined),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

/** Every provider selection observes the same inventory and invalidation lifecycle. */
export function useAccounts(): UseQueryResult<ProviderAccountsByProvider>;
export function useAccounts(providerId: string): UseQueryResult<ProviderAccountSummary[]>;
export function useAccounts<Account extends ProviderAccountSummary>(
  providerId: string,
  accepts: (account: ProviderAccountSummary) => account is Account
): UseQueryResult<Account[]>;
export function useAccounts(
  providerId?: string,
  accepts?: (account: ProviderAccountSummary) => boolean
): UseQueryResult<ProviderAccountsByProvider | ProviderAccountSummary[]> {
  return useQuery({
    ...providerAccountsQueryOptions(),
    select: (inventory) => {
      if (providerId === undefined) return inventory;
      const accounts = inventory[providerId] ?? [];
      return accepts ? accounts.filter(accepts) : accounts;
    },
  });
}

export async function invalidateProviderAccountState(queryClient: QueryClient): Promise<void> {
  for (const queryKey of [['issues:initial'], ['issues:search']]) {
    await queryClient.cancelQueries({ queryKey });
    await queryClient.invalidateQueries({ queryKey, refetchType: 'none' });
  }
  await queryClient.invalidateQueries({ queryKey: PROVIDER_ACCOUNTS_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: ISSUE_CONNECTION_STATUS_QUERY_KEY });
  for (const queryKey of [['issues:initial'], ['issues:search']]) {
    void queryClient.refetchQueries({ queryKey, type: 'active' });
  }
}
