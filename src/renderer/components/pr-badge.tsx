import { type PullRequest } from '@shared/pull-requests';
import { cn } from '@renderer/lib/utils';
import { PrNumberBadge, StatusIcon } from '../core/projects/components/pr-row';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

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
            <StatusIcon className="size-3" status={pr.status} />
          </div>
        );
    }
  };

  return (
    <Popover>
      <PopoverTrigger openOnHover>{renderBadge()}</PopoverTrigger>
      <PopoverContent>
        <div>Pr card</div>
      </PopoverContent>
    </Popover>
  );
}
