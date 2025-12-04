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
}: {
  installed?: boolean;
  authenticated?: boolean;
  user?: GithubUser;
  className?: string;
  onConnect?: () => void;
  isLoading?: boolean;
  statusMessage?: string;
}) {
  // Not installed - show install button
  if (!installed) {
    return (
      <Button
        onClick={onConnect}
        disabled={isLoading}
        variant="default"
        size="sm"
        className={`w-full justify-start gap-2 items-center py-2 ${className}`}
      >
        {isLoading ? (
          <>
            <Spinner size="sm" />
            <span className="text-xs font-medium">
              {statusMessage || 'Installing GitHub CLI...'}
            </span>
          </>
        ) : (
          <>
            <Download className="h-4 w-4 flex-shrink-0" />
            <div className="flex flex-col items-start gap-0.5">
              <span className="text-xs font-medium leading-tight">Connect GitHub</span>
              <span className="text-[10px] opacity-80 leading-tight">Install & sign in</span>
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
        className={`w-full justify-start gap-2 items-center py-2 ${className}`}
      >
        {isLoading ? (
          <>
            <Spinner size="sm" />
            <span className="text-xs font-medium">
              {statusMessage || 'Connecting to GitHub...'}
            </span>
          </>
        ) : (
          <>
            <Github className="h-4 w-4 flex-shrink-0" />
            <div className="flex flex-col items-start gap-0.5">
              <span className="text-xs font-medium leading-tight">Connect GitHub</span>
              <span className="text-[10px] opacity-80 leading-tight">Sign in with GitHub</span>
            </div>
          </>
        )}
      </Button>
    );
  }

  // Authenticated - show user info
  const displayName = user?.login || user?.name || 'GitHub account';
  const avatarUrl = (user as any)?.avatar_url as string | undefined;

  return (
    <div
      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground ${className}`}
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={displayName}
          className="h-5 w-5 rounded-full object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        <img
          src={githubLogo}
          alt="GitHub"
          className="h-5 w-5 rounded-sm object-contain dark:invert"
        />
      )}
      <span className="truncate font-medium">{displayName}</span>
    </div>
  );
}

export default GithubStatus;
