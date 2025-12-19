import React from 'react';
import { Download, Github } from 'lucide-react';
import githubLogo from '../../assets/images/github.png';
import { Button } from './ui/button';
import { Spinner } from './ui/spinner';

type GithubUser = { login?: string; name?: string; avatar_url?: string } | null;

export function GithubStatus({
  installed,
  authenticated,
  user,
  className = '',
  onConnect,
  isLoading = false,
  statusMessage,
  isInitialized = false,
}: {
  installed?: boolean;
  authenticated?: boolean;
  user?: GithubUser;
  className?: string;
  onConnect?: () => void;
  isLoading?: boolean;
  statusMessage?: string;
  isInitialized?: boolean;
}) {
  // Not initialized - don't show anything to avoid flash of incorrect state
  if (!isInitialized) {
    return null;
  }

  // Not installed - show install button
  if (!installed) {
    return (
      <Button
        onClick={onConnect}
        disabled={isLoading}
        variant="default"
        size="sm"
        className={`w-full min-w-0 items-center justify-start gap-2 overflow-hidden py-2 ${className}`}
      >
        {isLoading ? (
          <>
            <Spinner size="sm" className="flex-shrink-0" />
            <span className="min-w-0 truncate text-xs font-medium">
              {statusMessage || 'Installing GitHub CLI...'}
            </span>
          </>
        ) : (
          <>
            <Download className="h-4 w-4 flex-shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
              <span className="w-full truncate text-xs font-medium leading-tight">
                Connect GitHub
              </span>
              <span className="w-full truncate text-[10px] leading-tight opacity-80">
                Install & sign in
              </span>
            </div>
          </>
        )}
      </Button>
    );
  }

  // Not authenticated - show sign in button
  if (!authenticated) {
    return (
      <Button
        onClick={onConnect}
        disabled={isLoading}
        variant="default"
        size="sm"
        className={`w-full min-w-0 items-center justify-start gap-2 overflow-hidden py-2 ${className}`}
      >
        {isLoading ? (
          <>
            <Spinner size="sm" className="flex-shrink-0" />
            <span className="min-w-0 truncate text-xs font-medium">
              {statusMessage || 'Connecting to GitHub...'}
            </span>
          </>
        ) : (
          <>
            <Github className="h-4 w-4 flex-shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
              <span className="w-full truncate text-xs font-medium leading-tight">
                Connect GitHub
              </span>
              <span className="w-full truncate text-[10px] leading-tight opacity-80">
                Sign in with GitHub
              </span>
            </div>
          </>
        )}
      </Button>
    );
  }

  // Authenticated - show user info
  const displayName = user?.login || user?.name || 'GitHub account';

  return (
    <div
      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground ${className}`}
    >
      <img
        src={githubLogo}
        alt="GitHub"
        className="h-5 w-5 rounded-sm object-contain dark:invert"
      />
      <span className="truncate font-medium">{displayName}</span>
    </div>
  );
}

export default GithubStatus;
