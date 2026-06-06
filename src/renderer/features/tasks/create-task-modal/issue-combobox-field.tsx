import { ISSUE_PROVIDER_META } from '@renderer/features/integrations/issue-provider-meta';
import {
  IssueSelector,
  type IssueSelectorTriggerContext,
  ProviderLogo,
  SelectedIssueValue,
} from '@renderer/features/tasks/components/issue-selector/issue-selector';
import { cn } from '@renderer/utils/utils';
import type { LinkedIssue } from '@shared/linked-issue';

interface IssueComboboxFieldProps {
  value: LinkedIssue | null;
  onValueChange: (issue: LinkedIssue | null) => void;
  projectId?: string;
  repositoryUrl?: string;
  projectPath?: string;
  disabled?: boolean;
  className?: string;
}

function ModalPlaceholder({ issueProvider, connectedProviderCount }: IssueSelectorTriggerContext) {
  return (
    <span className="flex h-14 w-full items-center justify-center gap-2 p-2 text-sm text-foreground-passive transition-colors hover:bg-background-2">
      Select a
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
            <ProviderLogo provider={issueProvider} className="size-3.5" />
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
  projectId,
  repositoryUrl = '',
  projectPath = '',
  disabled,
  className,
}: IssueComboboxFieldProps) {
  return (
    <IssueSelector
      value={value}
      onValueChange={onValueChange}
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
          <ModalPlaceholder {...ctx} />
        </div>
      )}
    />
  );
}
