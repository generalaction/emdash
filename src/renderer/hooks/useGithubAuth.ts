import { useCallback, useEffect, useState } from 'react';

type GithubUser = any;

type GithubCache = {
  installed: boolean;
  authenticated: boolean;
  user: GithubUser | null;
} | null;

let cachedGithubStatus: GithubCache = null;

export function useGithubAuth() {
  const [installed, setInstalled] = useState<boolean>(() => cachedGithubStatus?.installed ?? true);
  const [authenticated, setAuthenticated] = useState<boolean>(
    () => cachedGithubStatus?.authenticated ?? false
  );
  const [user, setUser] = useState<GithubUser | null>(() => cachedGithubStatus?.user ?? null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isInitialized, setIsInitialized] = useState<boolean>(() => !!cachedGithubStatus);

  const syncCache = useCallback(
    (next: { installed: boolean; authenticated: boolean; user: GithubUser | null }) => {
      cachedGithubStatus = next;
      setInstalled(next.installed);
      setAuthenticated(next.authenticated);
      setUser(next.user);
      setIsInitialized(true);
    },
    []
  );

  const checkStatus = useCallback(async () => {
    try {
      const status = await window.electronAPI.githubGetStatus();
      const normalized = {
        installed: !!status?.installed,
        authenticated: !!status?.authenticated,
        user: status?.user || null,
      };
      syncCache(normalized);
      return status;
    } catch (e) {
      const fallback = { installed: false, authenticated: false, user: null };
      syncCache(fallback);
      return fallback;
    }
  }, [syncCache]);

  const login = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await window.electronAPI.githubAuth();
      // Device Flow returns device code info, not immediate success
      // The modal will handle the actual authentication
      return result;
    } finally {
      setIsLoading(false);
    }
  }, [syncCache]);

  const logout = useCallback(async () => {
    try {
      await window.electronAPI.githubLogout();
    } finally {
      syncCache({
        installed: cachedGithubStatus?.installed ?? true,
        authenticated: false,
        user: null,
      });
    }
  }, [syncCache]);

  useEffect(() => {
    // If we have cached status, mark as initialized but still refresh in background
    if (cachedGithubStatus) {
      setIsInitialized(true);
      // Still refresh in background to ensure we have the latest status
      void checkStatus();
      return;
    }
    // No cache - check status immediately
    void checkStatus();
  }, [checkStatus]);

  return {
    installed,
    authenticated,
    user,
    isLoading,
    isInitialized,
    checkStatus,
    login,
    logout,
  };
}
