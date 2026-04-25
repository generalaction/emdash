import { LogIn, LogOut, User } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '@renderer/lib/hooks/use-toast';
import {
  useAccountHealth,
  useAccountSession,
  useAccountSignIn,
  useAccountSignOut,
} from '@renderer/lib/hooks/useAccount';
import { Button } from '@renderer/lib/ui/button';
import { ServerUnavailableMessage } from './ServerUnavailableMessage';

export function AccountTab() {
  const { data: session, isLoading } = useAccountSession();
  const { data: serverAvailable } = useAccountHealth();
  const signInMutation = useAccountSignIn();
  const signOutMutation = useAccountSignOut();
  const { toast } = useToast();

  const [error, setError] = useState<string | null>(null);

  const user = session?.user ?? null;
  const isSignedIn = session?.isSignedIn ?? false;
  const hasAccount = session?.hasAccount ?? false;

  const handleSignIn = async () => {
    setError(null);
    try {
      const result = await signInMutation.mutateAsync(undefined);
      if (!result.success) {
        const message = result.error || 'Sign in failed';
        setError(message);
        toast({
          title: 'Sign in failed',
          description: message,
          variant: 'destructive',
        });
        return;
      }
      toast({
        title: 'Signed in to Emdash',
        description: result.user ? `Connected as @${result.user.username}` : 'Signed in',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign in failed';
      setError(message);
      toast({
        title: 'Sign in failed',
        description: message,
        variant: 'destructive',
      });
    }
  };

  const handleSignOut = async () => {
    await signOutMutation.mutateAsync();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        Loading account...
      </div>
    );
  }

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
          <Button
            type="button"
            className="w-fit"
            onClick={handleSignOut}
            disabled={signOutMutation.isPending}
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign Out
          </Button>
        </div>
      </div>
    );
  }

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
            <Button
              type="button"
              className="w-fit"
              onClick={handleSignIn}
              disabled={signInMutation.isPending}
            >
              <LogIn className="h-3.5 w-3.5" />
              {signInMutation.isPending ? 'Signing in...' : 'Sign In'}
            </Button>
          )}
        </div>
      </div>
    );
  }

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
          <Button
            type="button"
            className="w-fit"
            onClick={handleSignIn}
            disabled={signInMutation.isPending}
          >
            <LogIn className="h-3.5 w-3.5" />
            {signInMutation.isPending ? 'Creating account...' : 'Create Account'}
          </Button>
        )}
      </div>
    </div>
  );
}
