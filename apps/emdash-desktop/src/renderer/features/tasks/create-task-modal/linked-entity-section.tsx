import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
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
        <ToggleGroup
          className="gap-1! border-none bg-transparent p-1!"
          value={state.linkedType ? [state.linkedType] : []}
          onValueChange={([v]) => {
            state.setLinkedType((v as LinkedType) ?? null);
          }}
        >
          <ToggleGroupItem
            className="h-6! min-w-0! rounded-lg! px-2! py-0.5! text-xs"
            value="issue"
            disabled={!hasAnyIssueIntegration}
          >
            Issue
          </ToggleGroupItem>
          <ToggleGroupItem
            className="h-6! min-w-0! rounded-lg! px-2! py-0.5! text-xs"
            value="pr"
            disabled={!hasPrSupport}
          >
            Pull Request
          </ToggleGroupItem>
        </ToggleGroup>
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
