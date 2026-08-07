import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  GITHUB_ACCOUNT_STATE_QUERY_KEY,
  GITHUB_ACCOUNTS_QUERY_KEY,
  ISSUE_CONNECTION_STATUS_QUERY_KEY,
} from '@core/features/github/api/browser/useGithubAccounts';
import { getAccountClient } from './client';

export const ACCOUNT_SESSION_KEY = ['account:session'] as const;
const ACCOUNT_HEALTH_KEY = ['account:health'] as const;

export function useAccountSession() {
  return useQuery({
    queryKey: ACCOUNT_SESSION_KEY,
    queryFn: async () => (await getAccountClient()).getSession(),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useAccountSignIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (provider: string | undefined) =>
      (await getAccountClient()).signIn({ provider }),
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
    mutationFn: async (provider: string | undefined) =>
      (await getAccountClient()).linkProviderAccount({ provider }),
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
    mutationFn: async () => (await getAccountClient()).signOut(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...ACCOUNT_SESSION_KEY] });
    },
  });
}

export function useAccountHealth() {
  return useQuery({
    queryKey: ACCOUNT_HEALTH_KEY,
    queryFn: async () => (await getAccountClient()).checkHealth(),
    staleTime: 60_000,
  });
}

export function useFetchAccountHealth() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.fetchQuery({
      queryKey: ACCOUNT_HEALTH_KEY,
      queryFn: async () => (await getAccountClient()).checkHealth(),
      staleTime: 0,
    });
}
