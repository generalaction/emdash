import { ChevronDown, GitPullRequest } from 'lucide-react';
import { useState } from 'react';
import { InlinePrSelector, PrRow } from '@renderer/features/tasks/components/inline-pr-selector';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { cn } from '@renderer/utils/utils';
import type { PullRequest } from '@shared/pull-requests';

interface PrComboboxFieldProps {
  value: PullRequest | null;
  onValueChange: (pr: PullRequest | null) => void;
  projectId?: string;
  repositoryUrl?: string;
  disabled?: boolean;
}

export function PrComboboxField({
  value,
  onValueChange,
  projectId,
  repositoryUrl,
  disabled,
}: PrComboboxFieldProps) {
  const [open, setOpen] = useState(false);

  const handleValueChange = (pr: PullRequest | null) => {
    onValueChange(pr);
    if (pr) setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-md border border-border p-2 text-sm outline-none hover:bg-background-1 data-popup-open:bg-background-1',
          disabled && 'pointer-events-none opacity-50'
        )}
      >
        {value ? (
          <div className="flex min-w-0 items-center gap-2">
            <GitPullRequest className="size-3.5 shrink-0 text-foreground-muted" />
            <PrRow pr={value} />
          </div>
        ) : (
          <span className="text-foreground-passive">Select a pull request</span>
        )}
        <ChevronDown className="size-4 shrink-0 text-foreground-muted" />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} className="w-(--anchor-width) p-0">
        <InlinePrSelector
          value={value}
          onValueChange={handleValueChange}
          projectId={projectId}
          repositoryUrl={repositoryUrl}
          disabled={disabled}
        />
      </PopoverContent>
    </Popover>
  );
}
