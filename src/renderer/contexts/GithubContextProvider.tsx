import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useToast } from '../hooks/use-toast';
import { useModalContext } from './ModalProvider';
import { useEmdashAccount } from './EmdashAccountProvider';

type GithubUser = any;

type GithubContextValue = {
  installed: boolean;
  authenticated: boolean;
  user: GithubUser | null;
  /** True while the status query is fetching or login/logout mutation is pending */
  isLoading: boolean;
  isInitialized: boolean;

  /** True during the handleGithubConnect flow */
  githubLoading: boolean;
  githubStatusMessage: string | undefined;
  needsGhInstall: boolean;
  needsGhAuth: boolean;

  /** Full connect flow: authenticates via account or device flow and shows the modal */
  handleGithubConnect: () => Promise<void>;
  /** Raw login — starts the device flow and returns the IPC result */
  login: () => Promise<any>;
  /** Logout and invalidate cached status */
  logout: () => Promise<void>;
  /** Force-refresh status and return the raw result */
  checkStatus: () => Promise<any>;
};

const GITHUB_STATUS_KEY = ['github:status'] as const;

const GithubContext = createContext<GithubContextValue | null>(null);

export function GithubContextProvider({ children }: { children: React.ReactNode }) {
  const { showModal } = useModalContext();
  const { toast } = useToast();
  const { hasAccount, checkServerHealth, refreshSession } = useEmdashAccount();
  const queryClient = useQueryClient();

  const [githubLoading, setGithubLoading] = useState(false);
  const [githubStatusMessage, setGithubStatusMessage] = useState<string | undefined>();

  const {
    data: statusData,
    isFetching,
    isSuccess,
  } = useQuery({
    queryKey: GITHUB_STATUS_KEY,
    queryFn: () => window.electronAPI.githubGetStatus(),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const installed = statusData?.installed ?? true;
  const authenticated = statusData?.authenticated ?? false;
  const user: GithubUser | null = statusData?.user ?? null;
  const isInitialized = isSuccess;

  const needsGhInstall = isInitialized && !installed;
  const needsGhAuth = isInitialized && installed && !authenticated;

  const loginMutation = useMutation({
    mutationFn: () => window.electronAPI.githubAuth(),
  });

  const logoutMutation = useMutation({
    mutationFn: () => window.electronAPI.githubLogout(),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: GITHUB_STATUS_KEY }),
  });

  const isLoading = isFetching || loginMutation.isPending || logoutMutation.isPending;

  const checkStatus = useCallback(async () => {
    return queryClient.fetchQuery({
      queryKey: GITHUB_STATUS_KEY,
      queryFn: () => window.electronAPI.githubGetStatus(),
      staleTime: 0,
    });
  }, [queryClient]);

  const login = useCallback(() => loginMutation.mutateAsync(), [loginMutation]);

  const logout = useCallback(async () => {
    await logoutMutation.mutateAsync();
  }, [logoutMutation]);

  const handleDeviceFlowSuccess = useCallback(
    async (flowUser: GithubUser) => {
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
    const cleanupSuccess = window.electronAPI.onGithubAuthSuccess((data) => {
      void handleDeviceFlowSuccess(data.user);
    });
    const cleanupError = window.electronAPI.onGithubAuthError((data) => {
      handleDeviceFlowError(data.message || data.error);
    });
    const cleanupUserUpdated = window.electronAPI.onGithubAuthUserUpdated(() => {
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
      if (hasAccount && (await checkServerHealth())) {
        setGithubStatusMessage('Authenticating via Emdash account...');
        try {
          const result = await window.electronAPI.githubAuthOAuth();
          if (result.success) {
            setGithubLoading(false);
            setGithubStatusMessage(undefined);
            await refreshSession();
            await checkStatus();
            return;
          }
          console.warn('OAuth auth failed, falling back to Device Flow:', result.error);
        } catch (err) {
          console.warn('OAuth auth error, falling back to Device Flow:', err);
        }
      }

      setGithubStatusMessage('Starting authentication...');
      const result = await login();

      setGithubLoading(false);
      setGithubStatusMessage(undefined);

      if (result?.success) {
        showModal('githubDeviceFlowModal', {
          onSuccess: handleDeviceFlowSuccess,
          onError: handleDeviceFlowError,
        });
      } else {
        toast({
          title: 'Authentication Failed',
          description: result?.error || 'Could not start authentication',
          variant: 'destructive',
        });
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
  }, [
    hasAccount,
    checkServerHealth,
    refreshSession,
    toast,
    checkStatus,
    login,
    showModal,
    handleDeviceFlowSuccess,
    handleDeviceFlowError,
  ]);

  const value: GithubContextValue = {
    installed,
    authenticated,
    user,
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
