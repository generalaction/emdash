import {
  ISSUE_PROVIDER_META,
  ISSUE_PROVIDER_ORDER,
} from '@renderer/features/integrations/issue-provider-meta';
import {
  IssueSelector,
  type IssueSelectorTriggerContext,
  ProviderLogo,
  SelectedIssueValue,
} from '@renderer/features/tasks/components/issue-selector/issue-selector';
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

function ModalPlaceholder({
  issueProvider,
  connectedProviderCount,
  isProviderDisabled,
  setSelectedIssueProvider,
}: IssueSelectorTriggerContext) {
  return (
    <span className="flex w-full items-center justify-center gap-2 p-2 text-sm text-foreground-passive transition-colors hover:bg-background-2">
      Select a
      {connectedProviderCount > 1 ? (
        <Select
          value={issueProvider ?? undefined}
          onValueChange={(v) => v && setSelectedIssueProvider(v as Issue['provider'])}
        >
          <SelectTrigger
            aria-label="Select issue provider"
            className="flex h-auto items-center gap-1 border-none bg-transparent p-0 text-foreground-muted shadow-none hover:text-foreground focus:ring-0"
            onClick={(e) => e.stopPropagation()}
          >
            {issueProvider && <ProviderLogo provider={issueProvider} className="size-3.5" />}
            <span>{issueProvider ? ISSUE_PROVIDER_META[issueProvider].displayName : 'issue'}</span>
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
