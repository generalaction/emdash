import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { events, rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';
import {
  githubAccountsChangedChannel,
  githubAuthErrorChannel,
  githubAuthSuccessChannel,
  githubAuthUserUpdatedChannel,
} from '@shared/events/githubEvents';
import type {
  GitHubAccountState,
  GitHubAccountSummary,
  GitHubAuthResponse,
  GitHubTokenSource,
  GitHubUser,
} from '@shared/github';
import { useToast } from '../hooks/use-toast';
import {
  GITHUB_ACCOUNTS_QUERY_KEY,
  GITHUB_ACCOUNT_STATE_QUERY_KEY,
  ISSUE_CONNECTION_STATUS_QUERY_KEY,
} from '../hooks/useGithubAccounts';
import { useModalContext } from '../modal/modal-provider';

type GithubContextValue = {
  authenticated: boolean;
  user: GitHubUser | null;
  tokenSource: GitHubTokenSource;
  isLoading: boolean;
  isInitialized: boolean;
  githubLoading: boolean;
  githubStatusMessage: string | undefined;
  needsGhAuth: boolean;
  handleGithubConnect: () => Promise<void>;
  cancelGithubConnect: () => void;
  login: () => Promise<GitHubAuthResponse>;
  checkAccountState: () => Promise<GitHubAccountState>;
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
  const { showModal } = useModalContext();

  const [githubLoading, setGithubLoading] = useState(false);
  const [githubStatusMessage, setGithubStatusMessage] = useState<string | undefined>();

  const {
    data: accountState,
    isFetching,
    isSuccess,
  } = useQuery<GitHubAccountState>({
    queryKey: GITHUB_ACCOUNT_STATE_QUERY_KEY,
    queryFn: () => rpc.github.getAccountState(),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const authenticated = accountState?.connected ?? false;
  const defaultAccount = accountState?.accounts.find(
    (account) => account.accountId === accountState.defaultAccountId
  );
  const user = accountSummaryToUser(defaultAccount);
  const tokenSource: GitHubTokenSource = defaultAccount?.credentialSource ?? null;
  const isInitialized = isSuccess;
  const needsGhAuth = isInitialized && !authenticated;

  const prevAuthenticatedRef = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (!isInitialized) return;
    if (prevAuthenticatedRef.current === authenticated) return;
    prevAuthenticatedRef.current = authenticated;
    log.info('[GithubContext] auth state changed', {
      authenticated,
      user: user?.login ?? null,
      tokenSource,
    });
  }, [authenticated, isInitialized, tokenSource, user]);

  const invalidateGitHubState = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: GITHUB_ACCOUNTS_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: GITHUB_ACCOUNT_STATE_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: ISSUE_CONNECTION_STATUS_QUERY_KEY });
  }, [queryClient]);

  const loginMutation = useMutation({
    mutationFn: () => rpc.github.auth(),
    onSettled: invalidateGitHubState,
  });

  const isLoading = isFetching || loginMutation.isPending;

  const checkAccountState = useCallback(
    () =>
      queryClient.fetchQuery<GitHubAccountState>({
        queryKey: GITHUB_ACCOUNT_STATE_QUERY_KEY,
        queryFn: () => rpc.github.getAccountState(),
        staleTime: 0,
      }),
    [queryClient]
  );

  const login = useCallback(() => loginMutation.mutateAsync(), [loginMutation]);

  const handleDeviceFlowSuccess = useCallback(
    async (flowUser: GitHubUser) => {
      log.info('[GithubContext] auth success via device flow', { user: flowUser?.login });
      void checkAccountState();
      setTimeout(() => void checkAccountState(), 500);
      invalidateGitHubState();
      toast({
        title: 'Connected to GitHub',
        description: `Signed in as ${flowUser?.login || flowUser?.name || 'user'}`,
      });
    },
    [checkAccountState, invalidateGitHubState, toast]
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
    const cleanupSuccess = events.on(githubAuthSuccessChannel, (data) => {
      log.info('[GithubContext] received githubAuthSuccessChannel event', {
        user: data.user?.login,
      });
      void handleDeviceFlowSuccess(data.user);
    });
    const cleanupError = events.on(githubAuthErrorChannel, (data) => {
      log.info('[GithubContext] received githubAuthErrorChannel event', {
        message: data.message || data.error,
      });
      handleDeviceFlowError(data.message || data.error);
    });
    const cleanupUserUpdated = events.on(githubAuthUserUpdatedChannel, () => {
      log.info('[GithubContext] received githubAuthUserUpdatedChannel event');
      void checkAccountState();
    });
    const cleanupAccountsChanged = events.on(githubAccountsChangedChannel, () => {
      log.info('[GithubContext] received githubAccountsChangedChannel event');
      invalidateGitHubState();
    });

    return () => {
      cleanupSuccess();
      cleanupError();
      cleanupUserUpdated();
      cleanupAccountsChanged();
    };
  }, [handleDeviceFlowSuccess, handleDeviceFlowError, checkAccountState, invalidateGitHubState]);

  const handleGithubConnect = useCallback(async () => {
    setGithubLoading(true);
    setGithubStatusMessage(undefined);

    try {
      const freshState = await checkAccountState();
      if (freshState.connected) {
        setGithubLoading(false);
        return;
      }

      setGithubLoading(false);
      showModal('githubDeviceFlowModal', {
        onError: handleDeviceFlowError,
      });
      void login();
    } catch (error) {
      log.error('GitHub connection error:', error);
      setGithubLoading(false);
      setGithubStatusMessage(undefined);
      toast({
        title: 'Connection Failed',
        description: 'Failed to connect to GitHub. Please try again.',
        variant: 'destructive',
      });
    }
  }, [toast, checkAccountState, login, showModal, handleDeviceFlowError]);

  const cancelGithubConnect = useCallback(() => {
    setGithubLoading(false);
    setGithubStatusMessage(undefined);
    void rpc.github.authCancel();
    toast({
      title: 'GitHub connection unsuccessful',
      description: 'Device flow was canceled',
    });
  }, [toast]);

  const value: GithubContextValue = {
    authenticated,
    user,
    tokenSource,
    isLoading,
    isInitialized,
    githubLoading,
    githubStatusMessage,
    needsGhAuth,
    handleGithubConnect,
    cancelGithubConnect,
    login,
    checkAccountState,
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
