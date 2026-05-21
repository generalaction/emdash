import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { InlineIssueSelector } from '@renderer/features/tasks/components/issue-selector/inline-issue-selector';
import { SelectedIssueValue } from '@renderer/features/tasks/components/issue-selector/issue-selector';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { cn } from '@renderer/utils/utils';
import type { Issue } from '@shared/tasks';

interface IssueComboboxFieldProps {
  value: Issue | null;
  onValueChange: (issue: Issue | null) => void;
  projectId?: string;
  repositoryUrl?: string;
  projectPath?: string;
  disabled?: boolean;
  className?: string;
}

export function IssueComboboxField({
  value,
  onValueChange,
  projectId,
  repositoryUrl,
  projectPath,
  disabled,
  className,
}: IssueComboboxFieldProps) {
  const [open, setOpen] = useState(false);

  const handleValueChange = (issue: Issue | null) => {
    onValueChange(issue);
    if (issue) setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-md border border-border p-2 text-sm outline-none hover:bg-background-1 data-popup-open:bg-background-1',
          disabled && 'pointer-events-none opacity-50',
          className
        )}
      >
        {value ? (
          <SelectedIssueValue issue={value} />
        ) : (
          <span className="text-foreground-passive">Select an issue</span>
        )}
        <ChevronDown className="size-4 shrink-0 text-foreground-muted" />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} className="w-(--anchor-width) p-0">
        <InlineIssueSelector
          value={value}
          onValueChange={handleValueChange}
          projectId={projectId}
          repositoryUrl={repositoryUrl}
          projectPath={projectPath}
        />
      </PopoverContent>
    </Popover>
  );
}
