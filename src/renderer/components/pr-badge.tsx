import { type PullRequest } from '@shared/pull-requests';
import { PrNumberBadge, StatusIcon } from './projects/pr-row';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

interface PrBadgeProps {
  variant?: 'default' | 'compact';
  pr: PullRequest;
}

export function PrBadge({ variant = 'default', pr }: PrBadgeProps) {
  const renderBadge = () => {
    switch (variant) {
      case 'default':
        return (
          <div className="flex items-center gap-2 px-1.5 py-0.5 rounded-md bg-background-2 max-w-52">
            <StatusIcon className="size-3" status={pr.status} />
            <PrNumberBadge number={pr.metadata.number} className="text-[10px]" />
            <span className="text-xs text-foreground-muted truncate">{pr.title}</span>
          </div>
        );
      case 'compact':
        return (
          <div>
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
