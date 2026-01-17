import { useCallback, useEffect, useState } from 'react';
import { useGithubAuth } from './useGithubAuth';
import { useToast } from './use-toast';
import { ToastAction } from '../components/ui/toast';

/**
 * Hook to manage GitHub integration
 * Handles GitHub CLI installation, authentication, and device flow
 */

export interface GithubIntegrationState {
  githubLoading: boolean;
  githubStatusMessage: string | undefined;
  showDeviceFlowModal: boolean;
  needsGhInstall: boolean;
  needsGhAuth: boolean;
}

export interface GithubIntegrationActions {
  handleGithubConnect: () => Promise<void>;
  handleDeviceFlowSuccess: (user: any) => Promise<void>;
  handleDeviceFlowError: (error: string) => void;
  handleDeviceFlowClose: () => void;
  setShowDeviceFlowModal: (show: boolean) => void;
}

export function useGithubIntegration(): GithubIntegrationState & GithubIntegrationActions {
  const { toast } = useToast();
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
  const [showDeviceFlowModal, setShowDeviceFlowModal] = useState(false);
  const [platform, setPlatform] = useState<string>('');

  // Initialize platform
  useEffect(() => {
    window.electronAPI.getPlatform().then(setPlatform).catch(console.error);
  }, []);

  // GitHub connection handler
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
  }, [platform, checkStatus, githubLogin, toast]);

  // Device flow success handler
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

  // Device flow error handler
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

  // Device flow close handler
  const handleDeviceFlowClose = useCallback(() => {
    setShowDeviceFlowModal(false);
  }, []);

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

  const needsGhInstall = isGithubInitialized && !ghInstalled;
  const needsGhAuth = isGithubInitialized && ghInstalled && !isAuthenticated;

  return {
    // State
    githubLoading,
    githubStatusMessage,
    showDeviceFlowModal,
    needsGhInstall,
    needsGhAuth,

    // Actions
    handleGithubConnect,
    handleDeviceFlowSuccess,
    handleDeviceFlowError,
    handleDeviceFlowClose,
    setShowDeviceFlowModal,
  };
}