import { ISSUE_PROVIDER_META } from '@renderer/features/integrations/issue-provider-meta';
import {
  IssueSelector,
  type IssueSelectorTriggerContext,
  ProviderLogo,
  SelectedIssueValue,
} from '@renderer/features/tasks/components/issue-selector/issue-selector';
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

function ModalPlaceholder({ issueProvider, connectedProviderCount }: IssueSelectorTriggerContext) {
  return (
    <span className="flex h-14 w-full items-center justify-center gap-2 p-2 text-sm text-foreground-passive transition-colors hover:bg-background-2">
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        <span>Select a</span>
        {issueProvider && (
          <>
            <ProviderLogo
              provider={issueProvider}
              className={cn('size-3.5', connectedProviderCount > 1 && 'opacity-40')}
            />
            <span>{ISSUE_PROVIDER_META[issueProvider].displayName}</span>
          </>
        )}
        <span>issue</span>
      </span>
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
