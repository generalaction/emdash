import { useState } from 'react';
import { Branch } from '@shared/git';
import { InlineIssueSelector } from '@renderer/components/issue-selector/inline-issue-selector';
import { SelectedIssueValue } from '@renderer/components/issue-selector/issue-selector';
import { BranchPickerField } from './branch-picker-field';
import { TaskNameField } from './task-name-field';
import { FromIssueModeState } from './use-from-issue-mode';

interface FromIssueContentProps {
  state: FromIssueModeState;
  branches: Branch[];
  nameWithOwner?: string;
  projectPath?: string;
  disabled?: boolean;
}

export function FromIssueContent({
  state,
  branches,
  nameWithOwner = '',
  projectPath = '',
  disabled,
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
          nameWithOwner={nameWithOwner}
          projectPath={projectPath}
          disabled={disabled}
        />
      ) : (
        <div className="rounded-md border border-border overflow-hidden flex flex-col gap-2">
          <div className="flex flex-col gap-2 p-2">
            <SelectedIssueValue issue={state.linkedIssue!} />
          </div>
          <div className="flex items-center justify-between h-6 px-2 text-xs bg-background-1 border-t border-border">
            <div className="text-foreground-muted"></div>
            <div className="text-foreground-muted">
              <button className="flex items-center gap-2" onClick={() => setIsSelecting(true)}>
                Select another Issue
              </button>
            </div>
          </div>
        </div>
      )}

      <BranchPickerField state={state} branches={branches} />
      <TaskNameField state={state} />
    </div>
  );
}
