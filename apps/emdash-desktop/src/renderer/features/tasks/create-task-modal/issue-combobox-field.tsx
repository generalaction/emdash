import { X } from 'lucide-react';
import { ISSUE_PROVIDER_META } from '@renderer/features/integrations/issue-provider-meta';
import {
  IssueSelector,
  type IssueSelectorTriggerContext,
  ProviderLogo,
  IssueIdentifier,
  SelectedIssueValue,
} from '@renderer/features/tasks/components/issue-selector/issue-selector';
import { Button } from '@renderer/lib/ui/button';
import { cn } from '@renderer/utils/utils';
import type { LinkedIssue } from '@shared/core/linked-issue';

interface IssueComboboxFieldProps {
  value: LinkedIssue | null;
  onValueChange: (issue: LinkedIssue | null) => void;
  values?: LinkedIssue[];
  onValuesChange?: (issues: LinkedIssue[]) => void;
  projectId?: string;
  repositoryUrl?: string;
  projectPath?: string;
  disabled?: boolean;
  className?: string;
}

function ModalPlaceholder({
  issueProvider,
  connectedProviderCount,
  label = 'Select a',
}: IssueSelectorTriggerContext & { label?: string }) {
  if (label !== 'Select a') {
    return (
      <span className="flex h-14 w-full items-center justify-center gap-2 p-2 text-sm text-foreground-passive transition-colors hover:bg-background-2">
        {label}
      </span>
    );
  }

  return (
    <span className="flex h-14 w-full items-center justify-center gap-2 p-2 text-sm text-foreground-passive transition-colors hover:bg-background-2">
      {label}
      {connectedProviderCount > 1 ? (
        <span className="flex items-center gap-1">
          {issueProvider && (
            <ProviderLogo provider={issueProvider} className="size-3.5 opacity-40" />
          )}
          <span>{issueProvider ? ISSUE_PROVIDER_META[issueProvider].displayName : 'issue'}</span>
        </span>
      ) : (
        issueProvider && (
          <span className="flex items-center gap-1">
            <ProviderLogo provider={issueProvider} className="size-3.5 opacity-40" />
            {ISSUE_PROVIDER_META[issueProvider].displayName}
          </span>
        )
      )}
      issue
    </span>
  );
}

export function IssueComboboxField({
  value,
  onValueChange,
  values,
  onValuesChange,
  projectId,
  repositoryUrl = '',
  projectPath = '',
  disabled,
  className,
}: IssueComboboxFieldProps) {
  const selectedIssues = values ?? (value ? [value] : []);
  const isMultiSelect = Boolean(onValuesChange);
  const selectorValue = isMultiSelect ? null : value;

  const issueKey = (issue: LinkedIssue) => `${issue.provider}:${issue.identifier}:${issue.url}`;

  const handleValueChange = (issue: LinkedIssue | null) => {
    if (!isMultiSelect) {
      onValueChange(issue);
      return;
    }

    if (!issue) return;

    const exists = selectedIssues.some(
      (selectedIssue) => issueKey(selectedIssue) === issueKey(issue)
    );
    if (exists) return;

    const nextIssues = [...selectedIssues, issue];
    onValuesChange?.(nextIssues);
  };

  const removeIssue = (issue: LinkedIssue) => {
    const nextIssues = selectedIssues.filter(
      (selectedIssue) => issueKey(selectedIssue) !== issueKey(issue)
    );
    onValuesChange?.(nextIssues);
  };

  return (
    <div className="flex w-full flex-col">
      {isMultiSelect && selectedIssues.length > 0 ? (
        <div className="flex flex-col gap-1 border-b p-2">
          {selectedIssues.map((issue, index) => (
            <div
              key={issueKey(issue)}
              className={cn(
                'group flex min-h-7 w-full items-center gap-2 rounded-md bg-background-2 py-1 pr-1 pl-2 text-sm',
                disabled && 'pointer-events-none opacity-50'
              )}
            >
              <ProviderLogo provider={issue.provider} className="size-3.5" />
              <IssueIdentifier identifier={issue.identifier} provider={issue.provider} />
              {index === 0 ? (
                <span className="shrink-0 rounded bg-background-3 px-1 py-0.5 text-[10px] text-foreground-muted">
                  Primary
                </span>
              ) : null}
              <span className="min-w-0 flex-1 truncate text-foreground-muted">{issue.title}</span>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => removeIssue(issue)}
                disabled={disabled}
                className="opacity-70 group-hover:opacity-100"
              >
                <X className="size-3" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
      <IssueSelector
        value={selectorValue}
        onValueChange={handleValueChange}
        projectId={projectId}
        repositoryUrl={repositoryUrl}
        projectPath={projectPath}
        disabled={disabled}
        renderSelectedValue={(issue) => (
          <div
            className={cn(
              'flex w-full items-center justify-between gap-2 p-2 text-sm hover:bg-background-1 data-popup-open:bg-background-1',
              disabled && 'pointer-events-none opacity-50',
              issue.description && 'h-14',
              className
            )}
          >
            <SelectedIssueValue issue={issue} />
          </div>
        )}
        renderPlaceholder={(ctx) => (
          <div className={cn('w-full', disabled && 'pointer-events-none opacity-50', className)}>
            <ModalPlaceholder
              {...ctx}
              label={selectedIssues.length > 0 ? 'Add another issue' : undefined}
            />
          </div>
        )}
      />
    </div>
  );
}
