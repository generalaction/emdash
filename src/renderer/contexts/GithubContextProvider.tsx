import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  githubAuthErrorChannel,
  githubAuthSuccessChannel,
  githubAuthUserUpdatedChannel,
} from '@shared/events/githubEvents';
import type {
  GitHubAuthResponse,
  GitHubConnectResponse,
  GitHubStatusResponse,
  GitHubTokenSource,
  GitHubUser,
} from '@shared/github';
import { events, rpc } from '../core/ipc';
import { useToast } from '../hooks/use-toast';
import { useAppContext } from './AppContextProvider';

type GithubContextValue = {
  installed: boolean;
  authenticated: boolean;
  user: GitHubUser | null;
  tokenSource: GitHubTokenSource;
  isLoading: boolean;
  isInitialized: boolean;
  githubLoading: boolean;
  githubStatusMessage: string | undefined;
  needsGhInstall: boolean;
  needsGhAuth: boolean;
  handleGithubConnect: () => Promise<void>;
  login: () => Promise<GitHubAuthResponse>;
  logout: () => Promise<void>;
  checkStatus: () => Promise<GitHubStatusResponse>;
};

const GITHUB_STATUS_KEY = ['github:status'] as const;

const GithubContext = createContext<GithubContextValue | null>(null);

export function GithubContextProvider({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();
  const { platform } = useAppContext();
  const queryClient = useQueryClient();

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

  const installed = statusData?.installed ?? true;
  const authenticated = statusData?.authenticated ?? false;
  const user: GitHubUser | null = statusData?.user ?? null;
  const tokenSource: GitHubTokenSource = statusData?.tokenSource ?? null;
  const isInitialized = isSuccess;

  const needsGhInstall = isInitialized && !installed;
  const needsGhAuth = isInitialized && installed && !authenticated;

  const loginMutation = useMutation({
    mutationFn: () => rpc.github.auth(),
  });

  const logoutMutation = useMutation({
    mutationFn: () => rpc.github.logout(),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: GITHUB_STATUS_KEY }),
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
      void checkStatus();
      setTimeout(() => void checkStatus(), 500);
      toast({
        title: 'Connected to GitHub',
        description: `Signed in as ${flowUser?.login || flowUser?.name || 'user'}`,
      });
    },
    [checkStatus, toast]
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
      void handleDeviceFlowSuccess(data.user);
    });
    const cleanupError = events.on(githubAuthErrorChannel, (data) => {
      handleDeviceFlowError(data.message || data.error);
    });
    const cleanupUserUpdated = events.on(githubAuthUserUpdatedChannel, () => {
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
      setGithubStatusMessage('Checking for GitHub CLI...');
      const cliInstalled = await rpc.github.checkCLIInstalled();

      if (!cliInstalled) {
        let installMessage = 'Installing GitHub CLI...';
        if (platform === 'darwin') {
          installMessage = 'Installing GitHub CLI via Homebrew...';
        } else if (platform === 'linux') {
          installMessage = 'Installing GitHub CLI via apt...';
        } else if (platform === 'win32') {
          installMessage = 'Installing GitHub CLI via winget...';
        }

        setGithubStatusMessage(installMessage);
        try {
          await rpc.github.installCLI();
        } catch (err) {
          setGithubLoading(false);
          setGithubStatusMessage(undefined);
          toast({
            title: 'Installation Failed',
            description: `Could not auto-install gh CLI: ${(err as Error).message || 'Unknown error'}`,
            variant: 'destructive',
          });
          return;
        }

        setGithubStatusMessage('GitHub CLI installed! Setting up connection...');
        toast({
          title: 'GitHub CLI Installed',
          description: 'Now authenticating with GitHub...',
        });
        void checkStatus();
      }

      const result: GitHubConnectResponse = await rpc.github.connect();

      setGithubLoading(false);
      setGithubStatusMessage(undefined);

      if (result?.success) {
        await checkStatus();
        if (result.user) {
          toast({
            title: 'Connected to GitHub',
            description: `Signed in as ${result.user.login || result.user.name || 'user'}`,
          });
        }
      }
    } catch (error) {
      console.error('GitHub connection error:', error);
      setGithubLoading(false);
      setGithubStatusMessage(undefined);
      toast({
        title: 'Connection Failed',
        description: 'Failed to connect to GitHub. Please try again.',
        variant: 'destructive',
      });
    }
  }, [platform, toast, checkStatus]);

  const value: GithubContextValue = {
    installed,
    authenticated,
    user,
    tokenSource,
    isLoading,
    isInitialized,
    githubLoading,
    githubStatusMessage,
    needsGhInstall,
    needsGhAuth,
    handleGithubConnect,
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
