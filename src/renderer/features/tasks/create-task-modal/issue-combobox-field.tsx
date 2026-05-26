import { useState } from 'react';
import {
  ISSUE_PROVIDER_META,
  ISSUE_PROVIDER_ORDER,
} from '@renderer/features/integrations/issue-provider-meta';
import { InlineIssueSelector } from '@renderer/features/tasks/components/issue-selector/inline-issue-selector';
import {
  ProviderLogo,
  SelectedIssueValue,
} from '@renderer/features/tasks/components/issue-selector/issue-selector';
import { useIssueSearch } from '@renderer/features/tasks/components/issue-selector/useIssueSearch';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@renderer/lib/ui/select';
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
  repositoryUrl = '',
  projectPath = '',
  disabled,
  className,
}: IssueComboboxFieldProps) {
  const [open, setOpen] = useState(false);
  const issueSearchResult = useIssueSearch(repositoryUrl, projectPath, projectId);
  const { issueProvider, setSelectedIssueProvider, connectedProviderCount, isProviderDisabled } =
    issueSearchResult;

  const handleValueChange = (issue: Issue | null) => {
    onValueChange(issue);
    if (issue) setOpen(false);
  };

  const handleProviderChange = (provider: Issue['provider']) => {
    setSelectedIssueProvider(provider);
    if (value?.provider !== provider) onValueChange(null);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-md p-2 text-sm outline-none hover:bg-background-1 data-popup-open:bg-background-1',
          disabled && 'pointer-events-none opacity-50',
          className
        )}
      >
        {value ? (
          <SelectedIssueValue issue={value} />
        ) : (
          <span className="flex w-full items-center justify-center gap-2 text-foreground-passive">
            Select a
            {connectedProviderCount > 1 ? (
              <Select
                value={issueProvider ?? undefined}
                onValueChange={(v) => v && handleProviderChange(v as Issue['provider'])}
              >
                <SelectTrigger
                  aria-label="Select issue provider"
                  className="flex h-auto items-center gap-1 border-none bg-transparent p-0 text-foreground-muted shadow-none hover:text-foreground focus:ring-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  {issueProvider && <ProviderLogo provider={issueProvider} className="size-3.5" />}
                  <span>
                    {issueProvider ? ISSUE_PROVIDER_META[issueProvider].displayName : 'issue'}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {ISSUE_PROVIDER_ORDER.map((p) => (
                    <SelectItem
                      key={p}
                      value={p}
                      disabled={isProviderDisabled(p)}
                      className="text-foreground-secondary hover:text-foreground"
                    >
                      <ProviderLogo provider={p} className="size-3.5" />
                      {ISSUE_PROVIDER_META[p].displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              issueProvider && (
                <span className="flex items-center gap-1">
                  <ProviderLogo provider={issueProvider} className="size-3.5" />
                  {ISSUE_PROVIDER_META[issueProvider].displayName}
                </span>
              )
            )}
            issue
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} className="w-(--anchor-width) p-0">
        <InlineIssueSelector
          value={value}
          onValueChange={handleValueChange}
          projectId={projectId}
          repositoryUrl={repositoryUrl}
          projectPath={projectPath}
          issueSearchResult={issueSearchResult}
        />
      </PopoverContent>
    </Popover>
  );
}
