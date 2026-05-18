import { AlertCircle, CheckCircle, Github, LogIn, User } from 'lucide-react';
import { useRef, useState } from 'react';
import { useAccountSession, useAccountSignIn } from '@renderer/lib/hooks/useAccount';
import { useGithubContext } from '@renderer/lib/providers/github-context-provider';
import { Button } from '@renderer/lib/ui/button';

export function SignInStep({ onComplete }: { onComplete: () => void }) {
  const { data: session, isLoading: sessionLoading } = useAccountSession();
  const { authenticated: githubAuthenticated, tokenSource } = useGithubContext();
  const signInMutation = useAccountSignIn();
  const skippedSignInRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const isUsingGhCli = githubAuthenticated && tokenSource === 'cli';

  const handleSignIn = async () => {
    skippedSignInRef.current = false;
    setError(null);
    try {
      const result = await signInMutation.mutateAsync(undefined);
      if (!result.success) {
        if (skippedSignInRef.current) return;
        setError(result.error || 'Sign in failed');
        return;
      }
      if (skippedSignInRef.current) {
        return;
      }
      onComplete();
    } catch (err) {
      if (skippedSignInRef.current) return;
      setError(err instanceof Error ? err.message : 'Sign in failed');
    }
  };

  const handleSkip = () => {
    skippedSignInRef.current = true;
    onComplete();
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
          <h1 className="text-xl text-center">Connect GitHub</h1>
          <p className="text-md text-foreground-muted text-center">
            Emdash uses GitHub for git operations, pull requests and issues.
          </p>
        </div>
      </div>
      <div className="flex flex-col w-full gap-2">
        <Button size={'lg'} onClick={handleSignIn} disabled={signInMutation.isPending}>
          <LogIn className="h-4 w-4" />
          {signInMutation.isPending ? 'Signing in…' : 'Sign in with GitHub'}
        </Button>
        {error && (
          <div className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
            <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <Button size={'lg'} variant="outline" onClick={handleSkip}>
          {isUsingGhCli ? 'Continue with GitHub CLI' : 'Skip for now'}
        </Button>
      </div>
    </div>
  );
}
