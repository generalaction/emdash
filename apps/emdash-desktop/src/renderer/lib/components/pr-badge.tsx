import { ExternalLink } from 'lucide-react';
import { PrMergeLine } from '@renderer/lib/components/pr-merge-line';
import { PrUrlCopyButton } from '@renderer/lib/components/pr-url-copy-button';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { cn } from '@renderer/utils/utils';
import { getPrNumber, type PullRequest } from '@root/src/core/services/pull-requests/api';
import { rpc } from '../ipc';
import { Button } from '../ui/button';
import { RelativeTime } from '../ui/relative-time';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { PrNumberBadge } from './pr-number-badge';
import { StatusIcon } from './pr-status-icon';

interface PrBadgeProps {
  variant?: 'default' | 'compact';
  pr: PullRequest;
  className?: string;
  hoverDelay?: number;
}

export function PrBadge({ variant = 'default', pr, className, hoverDelay }: PrBadgeProps) {
  const renderBadge = () => {
    switch (variant) {
      case 'default':
        return (
          <div
            className={cn(
              'flex h-5 max-w-52 items-center gap-1.5 rounded-md bg-background-2 px-1.5 leading-none',
              className
            )}
          >
            <StatusIcon className="size-3" pr={pr} disableTooltip />
            <span className="shrink-0 font-sans text-xs leading-none text-foreground-muted">
              #{getPrNumber(pr) ?? 0}
            </span>
            <span className="truncate text-xs leading-none text-foreground-muted">{pr.title}</span>
          </div>
        );
      case 'compact':
        return (
          <div className={cn('flex h-5 items-center justify-center px-1 leading-none', className)}>
            <StatusIcon className="size-3" pr={pr} disableTooltip />
          </div>
        );
    }
  };

  return (
    <Popover>
      <PopoverTrigger className="flex items-center leading-none" openOnHover delay={hoverDelay}>
        {renderBadge()}
      </PopoverTrigger>
      <PopoverContent className="w-auto max-w-sm min-w-72">
        <div className="flex flex-col gap-2">
          <div className="no-wrap flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <StatusIcon pr={pr} className="size-3" />
              <span className="min-w-0 truncate text-sm leading-snug text-foreground">
                {pr.title}
              </span>
              <PrNumberBadge number={getPrNumber(pr) ?? 0} />
              <Tooltip>
                <TooltipTrigger>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="cursor-pointer"
                    onClick={() => rpc.app.openExternal(pr.url)}
                  >
                    <ExternalLink className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Open PR on GitHub</TooltipContent>
              </Tooltip>
              <PrUrlCopyButton url={pr.url} />
            </div>
            <RelativeTime
              value={pr.createdAt}
              className="text-xs text-foreground-passive"
              compact
            />
          </div>
          <PrMergeLine pr={pr} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
