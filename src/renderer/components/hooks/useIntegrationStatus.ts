import { useEffect, useState, useCallback } from 'react';
import { useGithubContext } from '../../contexts/GithubContextProvider';

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

  // GitLab
  isGitlabConnected: boolean | null;
  handleGitlabConnect: (credentials: { instanceUrl: string; token: string }) => Promise<void>;

  // Plain
  isPlainConnected: boolean | null;
  handlePlainConnect: (apiKey: string) => Promise<void>;

  // Forgejo
  isForgejoConnected: boolean | null;
  handleForgejoConnect: (credentials: { instanceUrl: string; token: string }) => Promise<void>;
}

/**
 * Hook to manage integration connection status for Linear, GitHub, Jira, GitLab, and Plain.
 * Checks connection status when isOpen becomes true.
 */
export function useIntegrationStatus(isOpen: boolean): IntegrationStatus {
  const [isLinearConnected, setIsLinearConnected] = useState<boolean | null>(null);
  const [isJiraConnected, setIsJiraConnected] = useState<boolean | null>(null);
  const [isGitlabConnected, setIsGitlabConnected] = useState<boolean | null>(null);
  const [isPlainConnected, setIsPlainConnected] = useState<boolean | null>(null);
  const [isForgejoConnected, setIsForgejoConnected] = useState<boolean | null>(null);

  const {
    installed: githubInstalled,
    authenticated: githubAuthenticated,
    login: githubLogin,
    isLoading: githubLoading,
  } = useGithubContext();

  const isGithubConnected = githubAuthenticated;

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

  // Check GitLab connection
  useEffect(() => {
    if (!isOpen) return;
    let cancel = false;
    const api = window.electronAPI as any;
    if (!api?.gitlabCheckConnection) {
      setIsGitlabConnected(false);
      return;
    }
    api
      .gitlabCheckConnection()
      .then((res: any) => {
        if (!cancel) setIsGitlabConnected(!!res?.success);
      })
      .catch(() => {
        if (!cancel) setIsGitlabConnected(false);
      });
    return () => {
      cancel = true;
    };
  }, [isOpen]);

  // Check Plain connection
  useEffect(() => {
    if (!isOpen) return;
    let cancel = false;
    const api = window.electronAPI as any;
    if (!api?.plainCheckConnection) {
      setIsPlainConnected(false);
      return;
    }
    api
      .plainCheckConnection()
      .then((res: any) => {
        if (!cancel) setIsPlainConnected(!!res?.connected);
      })
      .catch(() => {
        if (!cancel) setIsPlainConnected(false);
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
    try {
      await githubLogin();
    } catch (error) {
      console.error('Failed to connect GitHub:', error);
      throw error;
    }
  }, [githubLogin]);

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

  const handleGitlabConnect = useCallback(
    async (credentials: { instanceUrl: string; token: string }) => {
      const res = await window.electronAPI.gitlabSaveCredentials?.(credentials);
      if (res?.success) {
        setIsGitlabConnected(true);
      } else {
        throw new Error(res?.error || 'Failed to connect.');
      }
    },
    []
  );

  const handlePlainConnect = useCallback(async (apiKey: string) => {
    if (!apiKey) {
      throw new Error('API key is required');
    }
    if (!window?.electronAPI?.plainSaveToken) {
      throw new Error('Plain integration unavailable. Try restarting the app.');
    }
    const result = await window.electronAPI.plainSaveToken(apiKey);
    if (result?.success) {
      setIsPlainConnected(true);
    } else {
      throw new Error(result?.error || 'Could not connect Plain. Try again.');
    }
  }, []);

  // Check Forgejo connection
  useEffect(() => {
    if (!isOpen) return;
    let cancel = false;
    const api = window.electronAPI as any;
    if (!api?.forgejoCheckConnection) {
      setIsForgejoConnected(false);
      return;
    }
    api
      .forgejoCheckConnection()
      .then((res: any) => {
        if (!cancel) setIsForgejoConnected(!!res?.success);
      })
      .catch(() => {
        if (!cancel) setIsForgejoConnected(false);
      });
    return () => {
      cancel = true;
    };
  }, [isOpen]);

  const handleForgejoConnect = useCallback(
    async (credentials: { instanceUrl: string; token: string }) => {
      const api = window.electronAPI as any;
      const res = await api?.forgejoSaveCredentials?.({
        instanceUrl: credentials.instanceUrl,
        token: credentials.token,
      });
      if (res?.success) {
        setIsForgejoConnected(true);
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
    isGitlabConnected,
    handleGitlabConnect,
    isPlainConnected,
    handlePlainConnect,
    isForgejoConnected,
    handleForgejoConnect,
  };
}
