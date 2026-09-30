import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invalidateProviderAccountState } from '@core/features/integrations/api/browser/use-provider-accounts';
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
      void invalidateProviderAccountState(queryClient);
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
      void invalidateProviderAccountState(queryClient);
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
