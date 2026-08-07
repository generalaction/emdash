import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getGithubClient } from './client';

export const GITHUB_ACCOUNTS_QUERY_KEY = ['github:accounts'] as const;
export const GITHUB_ACCOUNT_STATE_QUERY_KEY = ['github:account-state'] as const;
export const ISSUE_CONNECTION_STATUS_QUERY_KEY = ['issues:connection-status'] as const;

function invalidateGitHubAccountState(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: GITHUB_ACCOUNTS_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: GITHUB_ACCOUNT_STATE_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: ISSUE_CONNECTION_STATUS_QUERY_KEY });
}

export function useGitHubAccounts() {
  return useQuery({
    queryKey: GITHUB_ACCOUNTS_QUERY_KEY,
    queryFn: async () => (await getGithubClient()).listAccounts(undefined),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useImportGitHubCliAccounts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => (await getGithubClient()).importCliAccounts(undefined),
    onSuccess: () => invalidateGitHubAccountState(queryClient),
  });
}

export function useGitHubDeviceFlowAuth() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => (await getGithubClient()).auth(undefined),
    onSettled: () => invalidateGitHubAccountState(queryClient),
  });
}

export function useSetDefaultGitHubAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (accountId: string) =>
      (await getGithubClient()).setDefaultAccount({ accountId }),
    onSuccess: () => invalidateGitHubAccountState(queryClient),
  });
}

export function useRemoveGitHubAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (accountId: string) => (await getGithubClient()).removeAccount({ accountId }),
    onSuccess: () => invalidateGitHubAccountState(queryClient),
  });
}
