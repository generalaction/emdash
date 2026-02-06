import { useCallback, useEffect, useState } from 'react';
import { useGithubAuth } from './useGithubAuth';

interface UseGithubIntegrationOptions {
  platform: string;
  toast: (opts: any) => void;
  setShowDeviceFlowModal: (show: boolean) => void;
}

export function useGithubIntegration(opts: UseGithubIntegrationOptions) {
  const { platform, toast, setShowDeviceFlowModal } = opts;

  const {
    installed: ghInstalled,
    authenticated: isAuthenticated,
    user,
    checkStatus,
    login: githubLogin,
    isInitialized: isGithubInitialized,
  } = useGithubAuth();

  const [githubLoading, setGithubLoading] = useState(false);
  const [githubStatusMessage, setGithubStatusMessage] = useState<string | undefined>();

  const needsGhInstall = isGithubInitialized && !ghInstalled;
  const needsGhAuth = isGithubInitialized && ghInstalled && !isAuthenticated;

  const handleGithubConnect = useCallback(async () => {
    setGithubLoading(true);
    setGithubStatusMessage(undefined);

    try {
      // Check if gh CLI is installed
      setGithubStatusMessage('Checking for GitHub CLI...');
      const cliInstalled = await window.electronAPI.githubCheckCLIInstalled();

      if (!cliInstalled) {
        // Detect platform for better messaging
        let installMessage = 'Installing GitHub CLI...';
        if (platform === 'darwin') {
          installMessage = 'Installing GitHub CLI via Homebrew...';
        } else if (platform === 'linux') {
          installMessage = 'Installing GitHub CLI via apt...';
        } else if (platform === 'win32') {
          installMessage = 'Installing GitHub CLI via winget...';
        }

        setGithubStatusMessage(installMessage);
        const installResult = await window.electronAPI.githubInstallCLI();

        if (!installResult.success) {
          setGithubLoading(false);
          setGithubStatusMessage(undefined);
          toast({
            title: 'Installation Failed',
            description: `Could not auto-install gh CLI: ${installResult.error || 'Unknown error'}`,
            variant: 'destructive',
          });
          return;
        }

        setGithubStatusMessage('GitHub CLI installed! Setting up connection...');
        toast({
          title: 'GitHub CLI Installed',
          description: 'Now authenticating with GitHub...',
        });
        await checkStatus(); // Refresh status
      }

      // Start Device Flow authentication (main process handles polling)
      setGithubStatusMessage('Starting authentication...');
      const result = await githubLogin();

      setGithubLoading(false);
      setGithubStatusMessage(undefined);

      if (result?.success) {
        // Show modal - it will receive events from main process
        setShowDeviceFlowModal(true);
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
  }, [platform, toast, checkStatus, githubLogin, setShowDeviceFlowModal]);

  const handleDeviceFlowSuccess = useCallback(
    async (flowUser: any) => {
      setShowDeviceFlowModal(false);

      // Refresh status immediately to update UI
      await checkStatus();

      // Also refresh again after a short delay to catch user info if it arrives quickly
      setTimeout(async () => {
        await checkStatus();
      }, 500);

      toast({
        title: 'Connected to GitHub',
        description: `Signed in as ${flowUser?.login || flowUser?.name || 'user'}`,
      });
    },
    [checkStatus, toast, setShowDeviceFlowModal]
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
    [toast, setShowDeviceFlowModal]
  );

  const handleDeviceFlowClose = useCallback(() => {
    setShowDeviceFlowModal(false);
  }, [setShowDeviceFlowModal]);

  // Subscribe to GitHub auth events from main process
  useEffect(() => {
    const cleanupSuccess = window.electronAPI.onGithubAuthSuccess((data) => {
      handleDeviceFlowSuccess(data.user);
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
    ghInstalled,
    isAuthenticated,
    user,
    checkStatus,
    isGithubInitialized,
    githubLoading,
    githubStatusMessage,
    needsGhInstall,
    needsGhAuth,
    handleGithubConnect,
    handleDeviceFlowSuccess,
    handleDeviceFlowError,
    handleDeviceFlowClose,
  };
}
