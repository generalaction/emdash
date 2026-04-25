import { CheckCircle, Github, LogIn, User } from 'lucide-react';
import { useState } from 'react';
import { useAccountSession, useAccountSignIn } from '@renderer/lib/hooks/useAccount';
import { Button } from '@renderer/lib/ui/button';

export function SignInStep({ onComplete }: { onComplete: () => void }) {
  const { data: session, isLoading: sessionLoading } = useAccountSession();
  const signInMutation = useAccountSignIn();
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setError(null);
    try {
      const result = await signInMutation.mutateAsync(undefined);
      if (!result.success) {
        setError(result.error || 'Sign in failed');
        return;
      }
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    }
  };

  if (sessionLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-foreground-muted">
        Loading...
      </div>
    );
  }

  if (session?.isSignedIn && session.user) {
    const { user } = session;
    return (
      <div className="flex flex-col space-y-8 max-w-sm">
        <div className="flex flex-col items-center justify-center gap-6">
          <div className="relative">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.username}
                className="h-14 w-14 rounded-full border border-border"
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-background-1">
                <User className="h-7 w-7 text-foreground-muted" />
              </div>
            )}
            <CheckCircle className="absolute -bottom-1 -right-1 h-5 w-5 text-primary fill-background" />
          </div>
          <div className="flex flex-col items-center justify-center gap-1">
            <h1 className="text-xl text-center">Connected as @{user.username}</h1>
            {user.email && (
              <p className="text-sm text-foreground-muted text-center">{user.email}</p>
            )}
          </div>
        </div>
        <Button size={'lg'} onClick={onComplete}>
          Continue
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col space-y-8 max-w-sm">
      <div className="flex flex-col items-center justify-center gap-6">
        <Github className="h-10 w-10" absoluteStrokeWidth strokeWidth={1.5} />
        <div className="flex flex-col items-center justify-center gap-2">
          <h1 className="text-xl text-center">Connect your GitHub account to Emdash</h1>
          <p className="text-md text-foreground-muted text-center">
            This will allow you to work with your GitHub repositories in Emdash
          </p>
        </div>
      </div>
      {error && <p className="text-sm text-destructive text-center">{error}</p>}
      <div className="flex flex-col w-full gap-2">
        <Button size={'lg'} onClick={handleSignIn} disabled={signInMutation.isPending}>
          <LogIn className="h-4 w-4" />
          {signInMutation.isPending ? 'Signing in...' : 'Sign in with GitHub'}
        </Button>
        <Button variant="ghost" onClick={onComplete} disabled={signInMutation.isPending}>
          Skip
        </Button>
      </div>
    </div>
  );
}
