import { useCallback, useEffect, useState } from 'react';
import { useToast } from './use-toast';
import { useGithubAuth } from './useGithubAuth';

export interface GithubAuthFlowState {
  showDeviceFlowModal: boolean;
  setShowDeviceFlowModal: (show: boolean) => void;
  githubLoading: boolean;
  githubStatusMessage: string | undefined;
}

export interface GithubAuthFlowHandlers {
  handleGithubConnect: () => void;
  handleDeviceFlowSuccess: (user: any) => Promise<void>;
  handleDeviceFlowError: (error: string) => void;
  handleDeviceFlowClose: () => void;
}

export function useGithubAuthFlow(
  onOpenSettings: () => void
): GithubAuthFlowState & GithubAuthFlowHandlers {
  const { toast } = useToast();
  const { checkStatus } = useGithubAuth();

  const [showDeviceFlowModal, setShowDeviceFlowModal] = useState(false);
  const [githubLoading, setGithubLoading] = useState(false);
  const [githubStatusMessage, setGithubStatusMessage] = useState<string | undefined>();

  const handleGithubConnect = useCallback(() => {
    setShowDeviceFlowModal(true);
  }, []);

  const handleDeviceFlowSuccess = useCallback(
    async (user: any) => {
      setShowDeviceFlowModal(false);

      // Refresh status immediately to update UI
      await checkStatus();

      // Also refresh again after a short delay to catch user info if it arrives quickly
      setTimeout(async () => {
        await checkStatus();
      }, 500);

      toast({
        title: 'Connected to GitHub',
        description: `Signed in as ${user?.login || user?.name || 'user'}`,
      });
    },
    [checkStatus, toast]
  );

  const handleDeviceFlowError = useCallback(
    (error: string) => {
      setShowDeviceFlowModal(false);

      toast({
        title: 'Authentication Failed',
        description: error,
        variant: 'destructive',
      });
    },
    [toast]
  );

  const handleDeviceFlowClose = useCallback(() => {
    setShowDeviceFlowModal(false);
  }, []);

  // Subscribe to GitHub auth events from main process
  useEffect(() => {
    const cleanupSuccess = window.electronAPI.onGithubAuthSuccess((data) => {
      void handleDeviceFlowSuccess(data.user);
    });

    const cleanupError = window.electronAPI.onGithubAuthError((data) => {
      handleDeviceFlowError(data.message || data.error);
    });

    // Listen for user info update (arrives after token is stored and gh CLI is authenticated)
    const cleanupUserUpdated = window.electronAPI.onGithubAuthUserUpdated(async () => {
      // Refresh status when user info becomes available
      await checkStatus();
    });

    return () => {
      cleanupSuccess();
      cleanupError();
      cleanupUserUpdated();
    };
  }, [handleDeviceFlowSuccess, handleDeviceFlowError, checkStatus]);

  return {
    showDeviceFlowModal,
    setShowDeviceFlowModal,
    githubLoading,
    githubStatusMessage,
    handleGithubConnect,
    handleDeviceFlowSuccess,
    handleDeviceFlowError,
    handleDeviceFlowClose,
  };
}
