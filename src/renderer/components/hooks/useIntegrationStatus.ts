import { useEffect, useState, useCallback } from 'react';
import { useGithubAuth } from '../../hooks/useGithubAuth';

interface IntegrationStatus {
  // Linear
  isLinearConnected: boolean | null;
  handleLinearConnect: (apiKey: string) => Promise<void>;

  // GitHub
  isGithubConnected: boolean;
  githubInstalled: boolean;
  githubLoading: boolean;
  handleGithubConnect: () => Promise<void>;

  // Jira
  isJiraConnected: boolean | null;
  handleJiraConnect: (credentials: {
    siteUrl: string;
    email: string;
    token: string;
  }) => Promise<void>;
}

/**
 * Hook to manage integration connection status for Linear, GitHub, and Jira.
 * Checks connection status when isOpen becomes true.
 */
export function useIntegrationStatus(isOpen: boolean): IntegrationStatus {
  const [isLinearConnected, setIsLinearConnected] = useState<boolean | null>(null);
  const [isJiraConnected, setIsJiraConnected] = useState<boolean | null>(null);

  const {
    installed: githubInstalled,
    authenticated: githubAuthenticated,
    login: githubLogin,
    isLoading: githubLoading,
  } = useGithubAuth();

  const isGithubConnected = githubInstalled && githubAuthenticated;

  // Check Linear connection
  useEffect(() => {
    if (!isOpen) return;
    let cancel = false;
    const api = window.electronAPI as any;
    if (!api?.linearCheckConnection) {
      setIsLinearConnected(false);
      return;
    }
    api
      .linearCheckConnection()
      .then((res: any) => {
        if (!cancel) setIsLinearConnected(!!res?.connected);
      })
      .catch(() => {
        if (!cancel) setIsLinearConnected(false);
      });
    return () => {
      cancel = true;
    };
  }, [isOpen]);

  // Check Jira connection
  useEffect(() => {
    if (!isOpen) return;
    let cancel = false;
    const api = window.electronAPI as any;
    if (!api?.jiraCheckConnection) {
      setIsJiraConnected(false);
      return;
    }
    api
      .jiraCheckConnection()
      .then((res: any) => {
        if (!cancel) setIsJiraConnected(!!res?.connected);
      })
      .catch(() => {
        if (!cancel) setIsJiraConnected(false);
      });
    return () => {
      cancel = true;
    };
  }, [isOpen]);

  const handleLinearConnect = useCallback(async (apiKey: string) => {
    if (!apiKey || !window?.electronAPI?.linearSaveToken) {
      throw new Error('Invalid API key');
    }
    const result = await window.electronAPI.linearSaveToken(apiKey);
    if (result?.success) {
      setIsLinearConnected(true);
    } else {
      throw new Error(result?.error || 'Could not connect Linear. Try again.');
    }
  }, []);

  const handleGithubConnect = useCallback(async () => {
    if (!githubInstalled) {
      try {
        await window.electronAPI.openExternal('https://cli.github.com/manual/installation');
      } catch (error) {
        console.error('Failed to open GitHub CLI install docs:', error);
      }
      return;
    }
    try {
      await githubLogin();
    } catch (error) {
      console.error('Failed to connect GitHub:', error);
      throw error;
    }
  }, [githubInstalled, githubLogin]);

  const handleJiraConnect = useCallback(
    async (credentials: { siteUrl: string; email: string; token: string }) => {
      const api = window.electronAPI as any;
      const res = await api?.jiraSaveCredentials?.(credentials);
      if (res?.success) {
        setIsJiraConnected(true);
      } else {
        throw new Error(res?.error || 'Failed to connect.');
      }
    },
    []
  );

  return {
    isLinearConnected,
    handleLinearConnect,
    isGithubConnected,
    githubInstalled,
    githubLoading,
    handleGithubConnect,
    isJiraConnected,
    handleJiraConnect,
  };
}
