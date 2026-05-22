import { useState } from 'react';
import { InlineIssueSelector } from '../components/issue-selector/inline-issue-selector';
import { SelectedIssueValue } from '../components/issue-selector/issue-selector';
import { BranchPickerField } from './branch-picker-field';
import {
  InitialConversationField,
  type InitialConversationState,
} from './initial-conversation-section';
import { TaskNameField } from './task-name-field';
import { type FromIssueModeState } from './use-from-issue-mode';

interface FromIssueContentProps {
  state: FromIssueModeState;
  projectId?: string;
  currentBranch?: string | null;
  repositoryUrl?: string;
  projectPath?: string;
  disabled?: boolean;
  isUnborn?: boolean;
  initialConversation?: InitialConversationState;
}

export function FromIssueContent({
  state,
  projectId,
  currentBranch,
  repositoryUrl = '',
  projectPath = '',
  disabled,
  isUnborn,
  initialConversation,
}: FromIssueContentProps) {
  const [isSelecting, setIsSelecting] = useState(!state.linkedIssue);

  const handleValueChange = (issue: Parameters<typeof state.setLinkedIssue>[0]) => {
    state.setLinkedIssue(issue);
    if (issue) setIsSelecting(false);
  };

  return (
    <div className="flex flex-col gap-4">
      {isSelecting || !state.linkedIssue ? (
        <InlineIssueSelector
          value={state.linkedIssue}
          onValueChange={handleValueChange}
          projectId={projectId}
          repositoryUrl={repositoryUrl}
          projectPath={projectPath}
          disabled={disabled}
        />
      ) : (
        <div className="flex flex-col gap-2 overflow-hidden rounded-md border border-border">
          <div className="flex flex-col gap-2 p-2">
            <SelectedIssueValue issue={state.linkedIssue!} />
          </div>
          <div className="flex h-6 items-center justify-between border-t border-border bg-background-1 px-2 text-xs">
            <div className="text-foreground-muted"></div>
            <div className="text-foreground-muted">
              <button className="flex items-center gap-2" onClick={() => setIsSelecting(true)}>
                Select another Issue
              </button>
            </div>
          </div>
        </div>
      )}

      <BranchPickerField
        state={state}
        projectId={projectId}
        currentBranch={currentBranch}
        isUnborn={isUnborn}
      />
      <TaskNameField state={state} />
      {initialConversation && (
        <InitialConversationField
          state={initialConversation}
          linkedIssue={state.linkedIssue ?? undefined}
          projectId={projectId}
        />
      )}
    </div>
  );
}
