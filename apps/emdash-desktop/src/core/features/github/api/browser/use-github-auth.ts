import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidateProviderAccountState } from '@core/features/integrations/api/browser/use-provider-accounts';
import { getGithubClient } from './client';

export function useImportGitHubCliAccounts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => (await getGithubClient()).importCliAccounts(undefined),
    onSuccess: () => invalidateProviderAccountState(queryClient),
  });
}

export function useGitHubDeviceFlowAuth() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => (await getGithubClient()).auth(undefined),
    onSettled: () => invalidateProviderAccountState(queryClient),
  });
}
