import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  GITHUB_ACCOUNT_STATE_QUERY_KEY,
  GITHUB_ACCOUNTS_QUERY_KEY,
  ISSUE_CONNECTION_STATUS_QUERY_KEY,
} from '@renderer/lib/hooks/useGithubAccounts';
import { rpc } from '@renderer/lib/ipc';

export const ACCOUNT_SESSION_KEY = ['account:session'] as const;
const ACCOUNT_HEALTH_KEY = ['account:health'] as const;

export function useAccountSession() {
  return useQuery({
    queryKey: ACCOUNT_SESSION_KEY,
    queryFn: () => rpc.account.getSession(),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useAccountSignIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (provider: string | undefined) => rpc.account.signIn(provider),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...ACCOUNT_SESSION_KEY] });
      void queryClient.invalidateQueries({ queryKey: GITHUB_ACCOUNTS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: GITHUB_ACCOUNT_STATE_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ISSUE_CONNECTION_STATUS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ['feature-flags'] });
    },
  });
}

export function useAccountLinkProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (provider: string | undefined) => rpc.account.linkProviderAccount(provider),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: GITHUB_ACCOUNTS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: GITHUB_ACCOUNT_STATE_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ISSUE_CONNECTION_STATUS_QUERY_KEY });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: [...ACCOUNT_SESSION_KEY] });
    },
  });
}

export function useAccountSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => rpc.account.signOut(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...ACCOUNT_SESSION_KEY] });
    },
  });
}

export function useAccountHealth() {
  return useQuery({
    queryKey: ACCOUNT_HEALTH_KEY,
    queryFn: () => rpc.account.checkHealth(),
    staleTime: 60_000,
  });
}

export function useFetchAccountHealth() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.fetchQuery({
      queryKey: ACCOUNT_HEALTH_KEY,
      queryFn: () => rpc.account.checkHealth(),
      staleTime: 0,
    });
}
