import { ToggleGroup } from '@emdash/ui/react/primitives';
import { IssueComboboxField } from './issue-combobox-field';
import { PrComboboxField } from './pr-combobox-field';
import type { LinkedType, CreateTaskState } from './use-create-task-state';

interface LinkedEntitySectionProps {
  state: CreateTaskState;
  hasAnyIssueIntegration: boolean;
  hasPrSupport: boolean;
  projectId?: string;
  repositoryUrl?: string;
  projectPath?: string;
}

export function LinkedEntitySection({
  state,
  hasAnyIssueIntegration,
  hasPrSupport,
  projectId,
  repositoryUrl,
  projectPath,
}: LinkedEntitySectionProps) {
  return (
    <div className="flex w-full flex-col justify-between overflow-hidden rounded-lg border">
      <div
        className={`flex w-full items-center justify-between gap-2 px-2 py-1 ${state.linkedType ? 'border-b' : ''}`}
      >
        <span className="shrink-0 text-sm text-foreground-muted">Based on</span>
        <ToggleGroup.Root
          className="bg-transparent"
          value={state.linkedType ? [state.linkedType] : []}
          onValueChange={([v]) => {
            state.setLinkedType((v as LinkedType) ?? null);
          }}
        >
          <ToggleGroup.Item className="text-xs" value="issue" disabled={!hasAnyIssueIntegration}>
            Issue
          </ToggleGroup.Item>
          <ToggleGroup.Item className="text-xs" value="pr" disabled={!hasPrSupport}>
            Pull Request
          </ToggleGroup.Item>
        </ToggleGroup.Root>
      </div>
      {state.linkedType === 'issue' && (
        <IssueComboboxField
          value={state.linkedIssue}
          onValueChange={state.setLinkedIssue}
          projectId={projectId}
          repositoryUrl={repositoryUrl}
          projectPath={projectPath}
        />
      )}
      {state.linkedType === 'pr' && (
        <PrComboboxField
          value={state.linkedPR}
          onValueChange={state.setLinkedPR}
          projectId={projectId}
          repositoryUrl={repositoryUrl}
        />
      )}
    </div>
  );
}
