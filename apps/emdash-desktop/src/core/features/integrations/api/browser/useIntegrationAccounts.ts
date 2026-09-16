import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { getIntegrationsClient } from './client';

export const INTEGRATION_ACCOUNTS_QUERY_KEY = 'integrations:accounts';
export const ISSUE_CONNECTION_STATUS_QUERY_KEY = ['issues:connection-status'] as const;
// Issue-list queries in `use-issues.ts` resolve per account, so they refresh
// when the connected accounts change.
const ISSUE_LIST_QUERY_PREFIXES = [['issues:initial'], ['issues:search']] as const;

export function integrationAccountsQueryKey(integrationId: string) {
  return [INTEGRATION_ACCOUNTS_QUERY_KEY, integrationId] as const;
}

/**
 * Invalidate every query that depends on an integration's connected accounts,
 * so the settings list, issue picker, and connection status re-resolve after a
 * connect, set-default, or remove.
 */
export function invalidateIntegrationAccountState(queryClient: QueryClient, integrationId: string) {
  void queryClient.invalidateQueries({ queryKey: integrationAccountsQueryKey(integrationId) });
  void queryClient.invalidateQueries({ queryKey: ISSUE_CONNECTION_STATUS_QUERY_KEY });
  for (const queryKey of ISSUE_LIST_QUERY_PREFIXES) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

export function useIntegrationAccounts(integrationId: string) {
  return useQuery({
    queryKey: integrationAccountsQueryKey(integrationId),
    queryFn: async () => (await getIntegrationsClient()).listAccounts({ integrationId }),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useSetDefaultIntegrationAccount(integrationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (accountId: string) =>
      (await getIntegrationsClient()).setDefaultAccount({ integrationId, accountId }),
    onSuccess: () => invalidateIntegrationAccountState(queryClient, integrationId),
  });
}

export function useRemoveIntegrationAccount(integrationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (accountId: string) =>
      (await getIntegrationsClient()).removeAccount({ integrationId, accountId }),
    onSuccess: () => invalidateIntegrationAccountState(queryClient, integrationId),
  });
}
