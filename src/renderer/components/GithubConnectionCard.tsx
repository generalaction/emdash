import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from './ui/button';
import { Spinner } from './ui/spinner';
import { RefreshCcw, LogOut, ExternalLink } from 'lucide-react';
import { useGithubAuth } from '../hooks/useGithubAuth';

type GithubConnectionStatus = 'connected' | 'disconnected' | 'missing';

interface GithubConnectionCardProps {
  onStatusChange?: (status: GithubConnectionStatus) => void;
}

const INSTALL_URL = 'https://cli.github.com/manual/installation';

const GithubConnectionCard: React.FC<GithubConnectionCardProps> = ({ onStatusChange }) => {
  const { installed, authenticated, user, isLoading, login, logout, checkStatus } = useGithubAuth();
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState<boolean>(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [cliInstalled, setCLIInstalled] = useState(true);

  const status: GithubConnectionStatus = useMemo(() => {
    if (!installed) {
      return 'missing';
    }
    return authenticated ? 'connected' : 'disconnected';
  }, [installed, authenticated]);

  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  useEffect(() => {
    // Check if CLI is installed on mount
    window.electronAPI.githubCheckCLIInstalled().then(setCLIInstalled);
  }, []);

  useEffect(() => {
    if (status === 'connected') {
      const handle = setTimeout(() => setMessage(null), 4000);
      return () => clearTimeout(handle);
    }
    return undefined;
  }, [status]);

  const displayName = user?.name || user?.login || null;
  const avatarUrl = (user as any)?.avatar_url as string | undefined;

  const handleConnect = useCallback(async () => {
    setMessage(null);
    setIsError(false);

    // Check if gh CLI is installed
    const cliPresent = await window.electronAPI.githubCheckCLIInstalled();

    if (!cliPresent) {
      // Offer to install
      setMessage('GitHub CLI not found. Installing...');
      setIsInstalling(true);

      const installResult = await window.electronAPI.githubInstallCLI();
      setIsInstalling(false);

      if (!installResult.success) {
        setMessage(`Could not auto-install gh CLI: ${installResult.error || 'Unknown error'}`);
        setIsError(true);
        return;
      }

      setMessage('GitHub CLI installed successfully!');
      setCLIInstalled(true);
    }

    // Proceed with OAuth authentication
    try {
      const result = await login(); // This now triggers OAuth flow
      await checkStatus();
      if (result?.success) {
        setMessage('Successfully connected to GitHub!');
        setIsError(false);
      } else {
        setMessage(result?.error || 'Authentication failed.');
        setIsError(true);
      }
    } catch (error) {
      console.error('GitHub authentication error:', error);
      setMessage('Authentication failed.');
      setIsError(true);
    }
  }, [login, checkStatus]);

  const handleDisconnect = useCallback(async () => {
    setMessage(null);
    setIsError(false);

    try {
      await logout();
      await checkStatus();
      setMessage('Disconnected.');
    } catch (error) {
      console.error('GitHub logout error:', error);
      setMessage('Failed to disconnect from GitHub.');
      setIsError(true);
    }
  }, [logout, checkStatus]);

  const handleRefresh = useCallback(async () => {
    try {
      await checkStatus();
    } catch (error) {
      console.error('GitHub status refresh failed:', error);
    }
  }, [checkStatus]);

  const handleInstall = useCallback(async () => {
    try {
      await window.electronAPI.openExternal(INSTALL_URL);
    } catch (error) {
      console.error('Failed to open GitHub CLI install docs:', error);
    }
  }, []);

  return (
    <div id="settings-github-card" className="space-y-3">
      {status === 'missing' ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-dashed border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
            <p className="text-sm text-muted-foreground">
              Install GitHub CLI (gh) to enable repo access.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={handleInstall}>
            <ExternalLink className="mr-2 h-4 w-4" /> Install GitHub CLI
          </Button>
        </div>
      ) : status === 'connected' ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="GitHub avatar"
                  className="h-6 w-6 rounded-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : null}
              <span className="text-sm font-medium text-foreground">
                Connected{displayName ? ` as ${displayName}` : ''}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleRefresh}
                disabled={isLoading}
                aria-label="Refresh GitHub status"
              >
                <RefreshCcw className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleDisconnect}
                disabled={isLoading}
              >
                <LogOut className="mr-2 h-4 w-4" /> Sign out
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            gh stays signed in to keep PR actions working.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Sign in to gh to enable cloning and PR actions.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              onClick={handleConnect}
              disabled={isLoading}
              aria-busy={isLoading}
            >
              {isLoading || isInstalling ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  {isInstalling ? 'Installing CLI...' : 'Connecting…'}
                </>
              ) : (
                'Sign in with GitHub'
              )}
            </Button>
            <Button type="button" variant="outline" onClick={handleRefresh} disabled={isLoading}>
              <RefreshCcw className="mr-2 h-4 w-4" /> Check status
            </Button>
          </div>
        </div>
      )}

      {message ? (
        <p
          className={`text-sm ${isError ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
};

export default GithubConnectionCard;
