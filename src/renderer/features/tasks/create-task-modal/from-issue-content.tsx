import { useRef, useState } from 'react';
import { buildLinkedIssueContextAction } from '@renderer/features/tasks/conversations/context-actions';
import { resolveContextActionText } from '@renderer/features/tasks/conversations/resolve-context-action-text';
import { useTaskSettings } from '@renderer/features/tasks/hooks/useTaskSettings';
import type { Issue } from '@shared/tasks';
import { InlineIssueSelector } from '../components/issue-selector/inline-issue-selector';
import { SelectedIssueValue } from '../components/issue-selector/issue-selector';
import { BranchPickerField } from './branch-picker-field';
import {
  InitialConversationField,
  type InitialConversationState,
} from './initial-conversation-section';
import { upsertInitialIssueContext } from './initial-conversation-text';
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
  initialConversation: InitialConversationState;
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
  const [isAddingIssueContext, setIsAddingIssueContext] = useState(false);
  const issueContextRequestId = useRef(0);
  const taskSettings = useTaskSettings();

  const handleValueChange = (issue: Issue | null) => {
    state.setLinkedIssue(issue);
    const requestId = ++issueContextRequestId.current;

    if (!issue) {
      setIsAddingIssueContext(false);
      return;
    }

    setIsSelecting(false);

    if (!taskSettings.includeIssueContextByDefault) {
      setIsAddingIssueContext(false);
      return;
    }

    const action = buildLinkedIssueContextAction(issue);
    if (!action) {
      setIsAddingIssueContext(false);
      return;
    }

    setIsAddingIssueContext(true);

    void resolveContextActionText({ action, linkedIssue: issue, projectId })
      .then((issueContext) => {
        if (requestId !== issueContextRequestId.current) return;

        initialConversation.setPrompt((current) =>
          upsertInitialIssueContext(current, issueContext)
        );
      })
      .finally(() => {
        if (requestId === issueContextRequestId.current) setIsAddingIssueContext(false);
      });
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
        branchNameState={state}
        projectId={projectId}
        currentBranch={currentBranch}
        isUnborn={isUnborn}
      />
      <TaskNameField state={state} />
      <InitialConversationField
        state={initialConversation}
        linkedIssue={state.linkedIssue ?? undefined}
        projectId={projectId}
        issueActionPending={isAddingIssueContext}
      />
    </div>
  );
}
