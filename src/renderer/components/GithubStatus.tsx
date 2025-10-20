import React from 'react';
import { AlertCircle } from 'lucide-react';
import githubLogo from '../../assets/images/github.png';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

type GithubUser = { login?: string; name?: string; avatar_url?: string } | null;

export function GithubStatus({
  installed,
  authenticated,
  user,
  className = '',
}: {
  installed?: boolean;
  authenticated?: boolean;
  user?: GithubUser;
  className?: string;
}) {
  if (!installed) {
    return (
      <TooltipProvider delayDuration={250}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={`flex items-start space-x-2 text-xs text-gray-600 dark:text-gray-400 ${className}`}
            >
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <div>
                <p className="font-medium">Install GitHub CLI</p>
                <p className="text-[11px] text-gray-700/80 dark:text-gray-300/80">
                  Required for repo status and auth
                </p>
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>GitHub CLI not installed</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (!authenticated) {
    return (
      <TooltipProvider delayDuration={250}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={`flex items-start space-x-2 text-xs text-gray-600 dark:text-gray-300 ${className}`}
            >
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <div>
                <p className="font-medium">GitHub not authenticated</p>
                <p className="text-[11px] text-gray-700/80 dark:text-gray-200/80">
                  Run <code className="rounded bg-gray-100 px-1">gh auth login</code>
                </p>
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>Not authenticated. Run: gh auth login</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  const displayName = user?.login || user?.name || 'GitHub account';
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={`flex items-center space-x-2 text-sm text-muted-foreground ${className}`}>
            <img
              src={githubLogo}
              alt="GitHub"
              className="h-4 w-4 rounded-sm object-contain dark:invert"
            />
            <span className="block truncate">{displayName}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>Authenticated via GitHub CLI{displayName ? ` as ${displayName}` : ''}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default GithubStatus;
