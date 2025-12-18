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
        className={`w-full items-center justify-start gap-2 py-2 min-w-0 overflow-hidden ${className}`}
      >
        {isLoading ? (
          <>
            <Spinner size="sm" className="flex-shrink-0" />
            <span className="text-xs font-medium truncate min-w-0">
              {statusMessage || 'Installing GitHub CLI...'}
            </span>
          </>
        ) : (
          <>
            <Download className="h-4 w-4 flex-shrink-0" />
            <div className="flex flex-col items-start gap-0.5 min-w-0 flex-1">
              <span className="text-xs font-medium leading-tight truncate w-full">Connect GitHub</span>
              <span className="text-[10px] leading-tight opacity-80 truncate w-full">Install & sign in</span>
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
        className={`w-full items-center justify-start gap-2 py-2 min-w-0 overflow-hidden ${className}`}
      >
        {isLoading ? (
          <>
            <Spinner size="sm" className="flex-shrink-0" />
            <span className="text-xs font-medium truncate min-w-0">
              {statusMessage || 'Connecting to GitHub...'}
            </span>
          </>
        ) : (
          <>
            <Github className="h-4 w-4 flex-shrink-0" />
            <div className="flex flex-col items-start gap-0.5 min-w-0 flex-1">
              <span className="text-xs font-medium leading-tight truncate w-full">Connect GitHub</span>
              <span className="text-[10px] leading-tight opacity-80 truncate w-full">Sign in with GitHub</span>
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
