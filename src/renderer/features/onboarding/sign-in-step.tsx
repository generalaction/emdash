import { AlertCircle, CheckCircle, Github, LogIn, User } from 'lucide-react';
import { useRef, useState } from 'react';
import { useAccountSession, useAccountSignIn } from '@renderer/lib/hooks/useAccount';
import { Button } from '@renderer/lib/ui/button';

export function SignInStep({ onComplete }: { onComplete: () => void }) {
  const { data: session, isLoading: sessionLoading } = useAccountSession();
  const signInMutation = useAccountSignIn();
  const skippedSignInRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

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
        Loading…
      </div>
    );
  }

  if (session?.isSignedIn && session.user) {
    const { user } = session;
    return (
      <div className="flex max-w-sm flex-col gap-y-8">
        <div className="flex flex-col items-center justify-center gap-6">
          <div className="relative">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.username}
                className="size-14 rounded-full border border-border"
              />
            ) : (
              <div className="flex size-14 items-center justify-center rounded-full border border-border bg-background-1">
                <User className="size-7 text-foreground-muted" />
              </div>
            )}
            <CheckCircle className="text-primary absolute -right-1 -bottom-1 size-5 fill-background" />
          </div>
          <div className="flex flex-col items-center justify-center gap-1">
            <h1 className="text-center text-xl">Connected as @{user.username}</h1>
            {user.email && (
              <p className="text-center text-sm text-foreground-muted">{user.email}</p>
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
    <div className="flex max-w-sm flex-col gap-y-8">
      <div className="flex flex-col items-center justify-center gap-6">
        <Github className="size-10" absoluteStrokeWidth strokeWidth={1.5} />
        <div className="flex flex-col items-center justify-center gap-2">
          <h1 className="text-center text-xl">Connect GitHub</h1>
          <p className="text-md text-center text-foreground-muted">
            Emdash uses GitHub for git operations, pull requests and issues.
          </p>
        </div>
      </div>
      <div className="flex w-full flex-col gap-2">
        <Button size={'lg'} onClick={handleSignIn} disabled={signInMutation.isPending}>
          <LogIn className="size-4" />
          {signInMutation.isPending ? 'Signing in…' : 'Sign in with GitHub'}
        </Button>
        {error && (
          <div className="bg-destructive/10 text-destructive flex items-start gap-1.5 rounded-md px-2.5 py-2 text-xs">
            <AlertCircle className="mt-px size-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <Button size={'lg'} variant="outline" onClick={handleSkip}>
          Skip for now
        </Button>
      </div>
    </div>
  );
}
