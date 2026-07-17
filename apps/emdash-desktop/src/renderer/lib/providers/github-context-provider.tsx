import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { createContext, useCallback, useContext, useEffect } from 'react';
import type {
  GitHubAccountState,
  GitHubAccountSummary,
  GitHubUser,
} from '@core/primitives/github/api';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';
import { log } from '@renderer/utils/logger';
import { useToast } from '../hooks/use-toast';
import {
  GITHUB_ACCOUNTS_QUERY_KEY,
  GITHUB_ACCOUNT_STATE_QUERY_KEY,
  ISSUE_CONNECTION_STATUS_QUERY_KEY,
} from '../hooks/useGithubAccounts';

type GithubContextValue = {
  user: GitHubUser | null;
  cancelGithubConnect: () => void;
};

const GithubContext = createContext<GithubContextValue | null>(null);

function accountSummaryToUser(account: GitHubAccountSummary | undefined): GitHubUser | null {
  if (!account) return null;
  const providerAccountId = account.accountId.slice(`${account.host}:`.length);
  const numericId = Number(providerAccountId);
  return {
    id: Number.isFinite(numericId) ? numericId : 0,
    login: account.login,
    name: '',
    email: '',
    avatar_url: account.avatarUrl,
  };
}

export function GithubContextProvider({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: accountState } = useQuery<GitHubAccountState>({
    queryKey: GITHUB_ACCOUNT_STATE_QUERY_KEY,
    queryFn: async () => (await getDesktopWireClient()).github.getAccountState(undefined),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const defaultAccount = accountState?.accounts.find(
    (account) => account.accountId === accountState.defaultAccountId
  );
  const user = accountSummaryToUser(defaultAccount);

  const invalidateGitHubState = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: GITHUB_ACCOUNTS_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: GITHUB_ACCOUNT_STATE_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: ISSUE_CONNECTION_STATUS_QUERY_KEY });
  }, [queryClient]);

  const refreshAccountState = useCallback(
    () =>
      queryClient.fetchQuery<GitHubAccountState>({
        queryKey: GITHUB_ACCOUNT_STATE_QUERY_KEY,
        queryFn: async () => (await getDesktopWireClient()).github.getAccountState(undefined),
        staleTime: 0,
      }),
    [queryClient]
  );

  const handleDeviceFlowSuccess = useCallback(
    async (flowUser: GitHubUser) => {
      log.info('[GithubContext] auth success via device flow', { user: flowUser?.login });
      void refreshAccountState();
      setTimeout(() => void refreshAccountState(), 500);
      invalidateGitHubState();
      toast({
        title: 'Connected to GitHub',
        description: `Signed in as ${flowUser?.login || flowUser?.name || 'user'}`,
      });
    },
    [refreshAccountState, invalidateGitHubState, toast]
  );

  const handleDeviceFlowError = useCallback(
    (error: string) => {
      toast({
        title: 'Authentication Failed',
        description: error,
        variant: 'destructive',
      });
    },
    [toast]
  );

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void getDesktopWireClient().then(async (client) => {
      const nextUnsubscribe = await client.github.events.subscribe(undefined, {
        onEvent: (event) => {
          if (event.type === 'auth-success') {
            void handleDeviceFlowSuccess(event.user);
          } else if (event.type === 'auth-error') {
            handleDeviceFlowError(event.message || event.error);
          } else if (event.type === 'accounts-changed') {
            invalidateGitHubState();
          }
        },
        onGap: invalidateGitHubState,
      });
      if (disposed) nextUnsubscribe();
      else unsubscribe = nextUnsubscribe;
    });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [handleDeviceFlowSuccess, handleDeviceFlowError, invalidateGitHubState]);

  const cancelGithubConnect = useCallback(() => {
    void getDesktopWireClient().then((client) => client.github.authCancel(undefined));
    toast({
      title: 'GitHub connection unsuccessful',
      description: 'Device flow was canceled',
    });
  }, [toast]);

  const value: GithubContextValue = {
    user,
    cancelGithubConnect,
  };

  return <GithubContext.Provider value={value}>{children}</GithubContext.Provider>;
}

export function useGithubContext() {
  const ctx = useContext(GithubContext);
  if (!ctx) {
    throw new Error('useGithubContext must be used inside GithubContextProvider');
  }
  return ctx;
}
