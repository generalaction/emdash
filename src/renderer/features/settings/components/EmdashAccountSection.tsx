import { Loader2, LogIn, LogOut, User } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '@renderer/lib/hooks/use-toast';
import {
  useAccountHealth,
  useAccountSession,
  useAccountSignIn,
  useAccountSignOut,
} from '@renderer/lib/hooks/useAccount';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { ServerUnavailableMessage } from './ServerUnavailableMessage';

export function EmdashAccountSection() {
  const { data: session, isLoading } = useAccountSession();
  const { data: serverAvailable } = useAccountHealth();
  const signInMutation = useAccountSignIn();
  const signOutMutation = useAccountSignOut();
  const { toast } = useToast();
  const showConfirmSignOut = useShowModal('confirmActionModal');
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
        description: result.user ? `Connected as ${result.user.username}` : 'Signed in',
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

  const performSignOut = async () => {
    try {
      await signOutMutation.mutateAsync();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign out failed';
      toast({
        title: 'Sign out failed',
        description: message,
        variant: 'destructive',
      });
    }
  };

  const handleSignOut = () => {
    showConfirmSignOut({
      title: 'Sign out of Emdash?',
      description: 'You will need to sign in again to reconnect your Emdash account.',
      confirmLabel: 'Sign Out',
      variant: 'default',
      onSuccess: () => void performSignOut(),
    });
  };

  if (isLoading) {
    return (
      <section className="bg-muted/10 rounded-lg border border-border/60 p-4">
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading account...
        </div>
      </section>
    );
  }

  if (isSignedIn && user) {
    return (
      <section className="bg-muted/10 rounded-lg border border-border/60 p-4">
        <div className="flex items-center gap-4">
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={user.username}
              className="h-12 w-12 rounded-full border border-border/60"
            />
          ) : (
            <div className="bg-muted flex h-12 w-12 items-center justify-center rounded-full border border-border/60">
              <User className="text-muted-foreground h-6 w-6" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">{user.username}</p>
            {user.email && <p className="text-muted-foreground text-xs">{user.email}</p>}
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
      </section>
    );
  }

  if (hasAccount && !isSignedIn) {
    return (
      <section className="bg-muted/10 rounded-lg border border-border/60 p-4">
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-sm font-medium text-foreground">Session expired</p>
            <p className="text-muted-foreground text-xs">
              Sign in again to reconnect your Emdash account.
            </p>
          </div>
          {error && <p className="text-destructive text-xs">{error}</p>}
          {serverAvailable === false ? (
            <ServerUnavailableMessage />
          ) : (
            <Button
              type="button"
              className="w-fit"
              onClick={() => void handleSignIn()}
              disabled={signInMutation.isPending}
            >
              <LogIn className="h-3.5 w-3.5" />
              {signInMutation.isPending ? 'Signing in...' : 'Sign In'}
            </Button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="bg-muted/10 rounded-lg border border-border/60 p-4">
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">Emdash Account</p>
          <p className="text-muted-foreground text-xs">
            Create an Emdash account to automatically connect GitHub using OAuth2.
          </p>
        </div>
        {error && <p className="text-destructive text-xs">{error}</p>}
        {serverAvailable === false ? (
          <ServerUnavailableMessage />
        ) : (
          <Button
            type="button"
            className="w-fit"
            onClick={() => void handleSignIn()}
            disabled={signInMutation.isPending}
          >
            <LogIn className="h-3.5 w-3.5" />
            {signInMutation.isPending ? 'Creating account...' : 'Create Account'}
          </Button>
        )}
      </div>
    </section>
  );
}
