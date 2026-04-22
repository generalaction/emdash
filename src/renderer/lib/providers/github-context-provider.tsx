import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  githubAuthErrorChannel,
  githubAuthSuccessChannel,
  githubAuthUserUpdatedChannel,
} from '@shared/events/githubEvents';
import type {
  GitHubAuthResponse,
  GitHubStatusResponse,
  GitHubTokenSource,
  GitHubUser,
} from '@shared/github';
import { events, rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';
import { useToast } from '../hooks/use-toast';
import { useAccountSession, useFetchAccountHealth } from '../hooks/useAccount';
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
  logout: () => Promise<void>;
  checkStatus: () => Promise<GitHubStatusResponse>;
};

const GITHUB_STATUS_KEY = ['github:status'] as const;
const ISSUE_CONNECTION_STATUS_QUERY_KEY = ['issues:connection-status'] as const;

const GithubContext = createContext<GithubContextValue | null>(null);

export function GithubContextProvider({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { showModal } = useModalContext();
  const { data: accountSession } = useAccountSession();
  const hasAccount = accountSession?.hasAccount === true;
  const fetchAccountHealth = useFetchAccountHealth();

  const [githubLoading, setGithubLoading] = useState(false);
  const [githubStatusMessage, setGithubStatusMessage] = useState<string | undefined>();

  const {
    data: statusData,
    isFetching,
    isSuccess,
  } = useQuery<GitHubStatusResponse>({
    queryKey: GITHUB_STATUS_KEY,
    queryFn: () => rpc.github.getStatus(),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const authenticated = statusData?.authenticated ?? false;
  const user: GitHubUser | null = statusData?.user ?? null;
  const tokenSource: GitHubTokenSource = statusData?.tokenSource ?? null;
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

  const loginMutation = useMutation({
    mutationFn: () => rpc.github.auth(),
  });

  const logoutMutation = useMutation({
    mutationFn: () => rpc.github.logout(),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: GITHUB_STATUS_KEY });
      void queryClient.invalidateQueries({ queryKey: ISSUE_CONNECTION_STATUS_QUERY_KEY });
    },
  });

  const isLoading = isFetching || loginMutation.isPending || logoutMutation.isPending;

  const checkStatus = useCallback(async () => {
    return queryClient.fetchQuery<GitHubStatusResponse>({
      queryKey: GITHUB_STATUS_KEY,
      queryFn: () => rpc.github.getStatus(),
      staleTime: 0,
    });
  }, [queryClient]);

  const login = useCallback(() => loginMutation.mutateAsync(), [loginMutation]);

  const logout = useCallback(async () => {
    await logoutMutation.mutateAsync();
  }, [logoutMutation]);

  const handleDeviceFlowSuccess = useCallback(
    async (flowUser: GitHubUser) => {
      log.info('[GithubContext] auth success via device flow', { user: flowUser?.login });
      void checkStatus();
      setTimeout(() => void checkStatus(), 500);
      void queryClient.invalidateQueries({ queryKey: ISSUE_CONNECTION_STATUS_QUERY_KEY });
      toast({
        title: 'Connected to GitHub',
        description: `Signed in as ${flowUser?.login || flowUser?.name || 'user'}`,
      });
    },
    [checkStatus, queryClient, toast]
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

  // Subscribe to GitHub auth IPC events from the main process
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
      void checkStatus();
    });

    return () => {
      cleanupSuccess();
      cleanupError();
      cleanupUserUpdated();
    };
  }, [handleDeviceFlowSuccess, handleDeviceFlowError, checkStatus]);

  const handleGithubConnect = useCallback(async () => {
    setGithubLoading(true);
    setGithubStatusMessage(undefined);

    try {
      const freshStatus = await checkStatus();
      if (freshStatus?.authenticated) {
        setGithubLoading(false);
        setGithubStatusMessage(undefined);
        return;
      }

      const isServerUp = hasAccount && (await fetchAccountHealth());
      if (hasAccount && isServerUp) {
        setGithubStatusMessage('Connecting via Emdash account...');
        const oauthResult = await rpc.github.connectOAuth();
        if (oauthResult?.success) {
          await checkStatus();
          void queryClient.invalidateQueries({ queryKey: ISSUE_CONNECTION_STATUS_QUERY_KEY });
          if (oauthResult.user) {
            toast({
              title: 'Connected to GitHub',
              description: `Signed in as ${oauthResult.user.login || oauthResult.user.name || 'user'}`,
            });
          }
          setGithubLoading(false);
          setGithubStatusMessage(undefined);
          return;
        }
      }

      setGithubLoading(false);
      setGithubStatusMessage(undefined);

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
  }, [
    toast,
    checkStatus,
    login,
    showModal,
    handleDeviceFlowError,
    hasAccount,
    fetchAccountHealth,
    queryClient,
  ]);

  const cancelGithubConnect = useCallback(() => {
    const flowLabel = githubStatusMessage ? 'OAuth flow' : 'Device flow';
    setGithubLoading(false);
    setGithubStatusMessage(undefined);
    rpc.github.authCancel();
    toast({
      title: 'GitHub connection unsuccessful',
      description: `${flowLabel} was canceled`,
    });
  }, [githubStatusMessage, toast]);

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
    logout,
    checkStatus,
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
