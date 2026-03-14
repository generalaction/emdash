import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

interface AccountUser {
  userId: string;
  username: string;
  avatarUrl: string;
  email: string;
}

interface EmdashAccountContextValue {
  user: AccountUser | null;
  isSignedIn: boolean;
  hasAccount: boolean;
  isLoading: boolean;
  serverAvailable: boolean | null;
  checkServerHealth: () => Promise<boolean>;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

const EmdashAccountContext = createContext<EmdashAccountContextValue>({
  user: null,
  isSignedIn: false,
  hasAccount: false,
  isLoading: true,
  serverAvailable: null,
  checkServerHealth: async () => false,
  signIn: async () => {},
  signOut: async () => {},
  refreshSession: async () => {},
});

export function useEmdashAccount() {
  return useContext(EmdashAccountContext);
}

export function EmdashAccountProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [hasAccount, setHasAccount] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [serverAvailable, setServerAvailable] = useState<boolean | null>(null);
  const validationDone = useRef(false);
  const queryClient = useQueryClient();

  const checkServerHealth = useCallback(async (): Promise<boolean> => {
    try {
      const result = await window.electronAPI.accountCheckServerHealth();
      const available = result.success && result.data?.available === true;
      setServerAvailable(available);
      return available;
    } catch {
      setServerAvailable(false);
      return false;
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const result = await window.electronAPI.accountGetSession();
        if (result.success && result.data) {
          setUser(result.data.user);
          setIsSignedIn(result.data.isSignedIn);
          setHasAccount(result.data.hasAccount);
        }
      } catch (err) {
        console.error('Failed to get account session:', err);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (isLoading) return;
    void checkServerHealth();
  }, [isLoading, checkServerHealth]);

  useEffect(() => {
    if (isLoading || validationDone.current) return;
    if (!hasAccount) return;
    validationDone.current = true;

    (async () => {
      try {
        const result = await window.electronAPI.accountValidateSession();
        if (result.success && result.data) {
          if (!result.data.valid) {
            setIsSignedIn(false);
            setUser(null);
          }
        }
      } catch {}
    })();
  }, [isLoading, hasAccount]);

  const signIn = useCallback(async () => {
    try {
      const result = await window.electronAPI.accountSignIn();
      if (result.success && result.data) {
        setUser(result.data.user);
        setIsSignedIn(true);
        setHasAccount(true);

        void queryClient.invalidateQueries({ queryKey: ['github:status'] });
      } else {
        throw new Error(result.error || 'Sign in failed');
      }
    } catch (err) {
      console.error('Account sign in failed:', err);
      throw err;
    }
  }, [queryClient]);

  const refreshSession = useCallback(async () => {
    try {
      const result = await window.electronAPI.accountGetSession();
      if (result.success && result.data) {
        setUser(result.data.user);
        setIsSignedIn(result.data.isSignedIn);
        setHasAccount(result.data.hasAccount);
      }
    } catch (err) {
      console.error('Failed to refresh account session:', err);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await window.electronAPI.accountSignOut();
      setUser(null);
      setIsSignedIn(false);
    } catch (err) {
      console.error('Account sign out failed:', err);
    }
  }, []);

  return (
    <EmdashAccountContext.Provider
      value={{
        user,
        isSignedIn,
        hasAccount,
        isLoading,
        serverAvailable,
        checkServerHealth,
        signIn,
        signOut,
        refreshSession,
      }}
    >
      {children}
    </EmdashAccountContext.Provider>
  );
}
