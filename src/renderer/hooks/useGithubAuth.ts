import { useCallback, useEffect, useState } from 'react';

type GithubUser = any;

type GithubAccount = {
  id: string;
  login: string;
  name: string;
  email: string;
  avatar_url: string;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type GithubCache = {
  installed: boolean;
  authenticated: boolean;
  user: GithubUser | null;
  activeAccount: GithubAccount | null;
  accounts: GithubAccount[];
} | null;

let cachedGithubStatus: GithubCache = null;

export function useGithubAuth() {
  const [installed, setInstalled] = useState<boolean>(() => cachedGithubStatus?.installed ?? true);
  const [authenticated, setAuthenticated] = useState<boolean>(
    () => cachedGithubStatus?.authenticated ?? false
  );
  const [user, setUser] = useState<GithubUser | null>(() => cachedGithubStatus?.user ?? null);
  const [activeAccount, setActiveAccount] = useState<GithubAccount | null>(
    () => cachedGithubStatus?.activeAccount ?? null
  );
  const [accounts, setAccounts] = useState<GithubAccount[]>(
    () => cachedGithubStatus?.accounts ?? []
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const syncCache = useCallback(
    (next: {
      installed: boolean;
      authenticated: boolean;
      user: GithubUser | null;
      activeAccount: GithubAccount | null;
      accounts: GithubAccount[];
    }) => {
      cachedGithubStatus = next;
      setInstalled(next.installed);
      setAuthenticated(next.authenticated);
      setUser(next.user);
      setActiveAccount(next.activeAccount);
      setAccounts(next.accounts);
    },
    []
  );

  const checkStatus = useCallback(async () => {
    try {
      const status = await window.electronAPI.githubGetStatus();
      const accountsResult = window.electronAPI.githubGetAccounts
        ? await window.electronAPI.githubGetAccounts()
        : { success: false };
      const activeAccountResult = window.electronAPI.githubGetActiveAccount
        ? await window.electronAPI.githubGetActiveAccount()
        : { success: false };

      const normalized = {
        installed: !!status?.installed,
        authenticated: !!status?.authenticated,
        user: status?.user || null,
        activeAccount:
          activeAccountResult?.success && activeAccountResult.account
            ? activeAccountResult.account
            : null,
        accounts: accountsResult?.success ? accountsResult.accounts || [] : [],
      };
      syncCache(normalized);
      return normalized;
    } catch (e) {
      const fallback = {
        installed: false,
        authenticated: false,
        user: null,
        activeAccount: null,
        accounts: [],
      };
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
        activeAccount: null,
        accounts: [],
      });
    }
  }, [syncCache]);

  // Multi-account methods
  const getAccounts = useCallback(async () => {
    try {
      // Check if method is available (for backward compatibility)
      if (!window.electronAPI.githubGetAccounts) {
        console.warn('githubGetAccounts method not available, using fallback');
        return [];
      }

      const result = await window.electronAPI.githubGetAccounts();
      if (result.success && result.accounts) {
        setAccounts(result.accounts);
        return result.accounts;
      }
      return [];
    } catch (error) {
      console.error('Failed to get GitHub accounts:', error);
      return [];
    }
  }, []);

  const getActiveAccount = useCallback(async () => {
    try {
      // Check if method is available (for backward compatibility)
      if (!window.electronAPI.githubGetActiveAccount) {
        console.warn('githubGetActiveAccount method not available, using fallback');
        return null;
      }

      const result = await window.electronAPI.githubGetActiveAccount();
      if (result.success && result.account) {
        const parsedId = Number.parseInt(result.account.id, 10);
        const normalizedId = Number.isNaN(parsedId) ? result.account.id : parsedId;

        setActiveAccount(result.account);
        setUser({
          id: normalizedId,
          login: result.account.login,
          name: result.account.name,
          email: result.account.email,
          avatar_url: result.account.avatar_url,
        });
        return result.account;
      }
      return null;
    } catch (error) {
      console.error('Failed to get active GitHub account:', error);
      return null;
    }
  }, []);

  const switchAccount = useCallback(async (accountId: string) => {
    setIsLoading(true);
    try {
      const result = await window.electronAPI.githubSwitchAccount(accountId);
      if (result.success) {
        // Update the active account and user
        await getActiveAccount();
        await getAccounts();
        return result;
      }
      throw new Error(result.error || 'Failed to switch account');
    } catch (error) {
      console.error('Failed to switch GitHub account:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [getActiveAccount, getAccounts]);

  const removeAccount = useCallback(async (accountId: string) => {
    try {
      const result = await window.electronAPI.githubRemoveAccount(accountId);
      if (result.success) {
        // Refresh accounts list
        await getAccounts();

        // If we removed the active account, get the new active one
        if (activeAccount?.id === accountId) {
          await getActiveAccount();
        }

        return result;
      }
      throw new Error(result.error || 'Failed to remove account');
    } catch (error) {
      console.error('Failed to remove GitHub account:', error);
      throw error;
    }
  }, [activeAccount?.id, getAccounts, getActiveAccount]);

  const setDefaultAccount = useCallback(async (accountId: string) => {
    try {
      const result = await window.electronAPI.githubSetDefaultAccount(accountId);
      if (result.success) {
        // Refresh accounts list to update default flags
        await getAccounts();
        return result;
      }
      throw new Error(result.error || 'Failed to set default account');
    } catch (error) {
      console.error('Failed to set default GitHub account:', error);
      throw error;
    }
  }, [getAccounts]);

  const refreshAccounts = useCallback(async () => {
    await Promise.all([
      getAccounts(),
      getActiveAccount(),
    ]);
  }, [getAccounts, getActiveAccount]);

  useEffect(() => {
    if (cachedGithubStatus) return;
    checkStatus();
  }, [checkStatus]);

  // Listen for authentication success events to refresh accounts
  useEffect(() => {
    const handleAuthSuccess = () => {
      refreshAccounts();
    };

    const unsubscribe = window.electronAPI.onGithubAuthSuccess?.(handleAuthSuccess);

    return () => {
      unsubscribe?.();
    };
  }, [refreshAccounts]);

  return {
    installed,
    authenticated,
    user,
    activeAccount,
    accounts,
    hasMultipleAccounts: accounts.length > 1,
    isLoading,
    checkStatus,
    login,
    logout,
    // Multi-account methods
    getAccounts,
    getActiveAccount,
    switchAccount,
    removeAccount,
    setDefaultAccount,
    refreshAccounts,
  };
}
