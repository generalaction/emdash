import { useEmdashAccount } from '@/contexts/EmdashAccountProvider';
import { User, LogOut, LogIn, AlertCircle } from 'lucide-react';
import { useState, useEffect } from 'react';

function ServerUnavailableMessage() {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
      <AlertCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <p className="text-xs text-muted-foreground">
        Emdash server is currently unavailable. Please try again later.
      </p>
    </div>
  );
}

export function AccountTab() {
  const {
    user,
    isSignedIn,
    hasAccount,
    isLoading,
    serverAvailable,
    checkServerHealth,
    signIn,
    signOut,
  } = useEmdashAccount();

  useEffect(() => {
    void checkServerHealth();
  }, [checkServerHealth]);

  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setError(null);
    setIsSigningIn(true);
    try {
      await signIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        Loading account...
      </div>
    );
  }

  // Signed in state
  if (isSignedIn && user) {
    return (
      <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
        <div className="flex items-center gap-4">
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={user.username}
              className="h-12 w-12 rounded-full border border-border/60"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border/60 bg-muted">
              <User className="h-6 w-6 text-muted-foreground" />
            </div>
          )}
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">
              Connected as <span className="font-semibold">@{user.username}</span>
            </p>
            {user.email && <p className="text-xs text-muted-foreground">{user.email}</p>}
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  // Has account but session expired
  if (hasAccount && !isSignedIn) {
    return (
      <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-sm font-medium text-foreground">Session expired</p>
            <p className="text-xs text-muted-foreground">
              Sign in again to reconnect your Emdash account.
            </p>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          {serverAvailable === false ? (
            <ServerUnavailableMessage />
          ) : (
            <button
              type="button"
              onClick={handleSignIn}
              disabled={isSigningIn || serverAvailable === null}
              className="flex w-fit items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              <LogIn className="h-3.5 w-3.5" />
              {isSigningIn ? 'Signing in...' : 'Sign In'}
            </button>
          )}
        </div>
      </div>
    );
  }

  // No account
  return (
    <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">Emdash Account</p>
          <p className="text-xs text-muted-foreground">
            Create an Emdash account to automatically connect GitHub using OAuth2.
          </p>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        {serverAvailable === false ? (
          <ServerUnavailableMessage />
        ) : (
          <button
            type="button"
            onClick={handleSignIn}
            disabled={isSigningIn || serverAvailable === null}
            className="flex w-fit items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            <LogIn className="h-3.5 w-3.5" />
            {isSigningIn ? 'Creating account...' : 'Create Account'}
          </button>
        )}
      </div>
    </div>
  );
}
