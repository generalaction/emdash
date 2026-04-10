import { ExternalLink } from 'lucide-react';
import { type PullRequest } from '@shared/pull-requests';
import { PrMergeLine } from '@renderer/features/projects/components/pr-merge-line';
import { PrNumberBadge, StatusIcon } from '@renderer/features/projects/components/pr-row';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { cn } from '@renderer/utils/utils';
import { rpc } from '../ipc';
import { Button } from '../ui/button';
import { RelativeTime } from '../ui/relative-time';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';

interface PrBadgeProps {
  variant?: 'default' | 'compact';
  pr: PullRequest;
  className?: string;
}

export function PrBadge({ variant = 'default', pr, className }: PrBadgeProps) {
  const renderBadge = () => {
    switch (variant) {
      case 'default':
        return (
          <div
            className={cn(
              'flex items-center gap-2 px-1.5 py-0.5 rounded-md bg-background-2 max-w-52',
              className
            )}
          >
            <StatusIcon className="size-3" status={pr.status} disableTooltip />
            <PrNumberBadge number={pr.metadata.number} className="text-[10px]" />
            <span className="text-xs text-foreground-muted truncate">{pr.title}</span>
          </div>
        );
      case 'compact':
        return (
          <div className={cn('px-1 flex items-center justify-center', className)}>
            <StatusIcon className="size-3" status={pr.status} disableTooltip />
          </div>
        );
    }
  };

  return (
    <Popover>
      <PopoverTrigger openOnHover>{renderBadge()}</PopoverTrigger>
      <PopoverContent>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 justify-between no-wrap">
            <div className="flex items-center gap-2  min-w-0">
              <StatusIcon status={pr.status} className="size-3" />
              <span className="text-sm text-foreground leading-snug truncate min-w-0">
                {pr.title}
              </span>
              <PrNumberBadge number={pr.metadata.number} />
              <Tooltip>
                <TooltipTrigger>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => rpc.app.openExternal(pr.url)}
                  >
                    <ExternalLink className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Open PR on github</TooltipContent>
              </Tooltip>
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
