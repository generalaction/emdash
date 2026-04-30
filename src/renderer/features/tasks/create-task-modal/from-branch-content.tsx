import { BranchPickerField } from './branch-picker-field';
import {
  InitialConversationField,
  type InitialConversationState,
} from './initial-conversation-section';
import { TaskNameField } from './task-name-field';
import { type FromBranchModeState } from './use-from-branch-mode';

interface FromBranchContentProps {
  state: FromBranchModeState;
  projectId?: string;
  currentBranch?: string | null;
  isUnborn?: boolean;
  initialConversation?: InitialConversationState;
  connectionId?: string;
}

export function FromBranchContent({
  state,
  projectId,
  currentBranch,
  isUnborn,
  initialConversation,
  connectionId,
}: FromBranchContentProps) {
  return (
    <div className="flex flex-col gap-4">
      <BranchPickerField
        state={state}
        projectId={projectId}
        currentBranch={currentBranch}
        isUnborn={isUnborn}
      />
      <TaskNameField state={state} />
      {initialConversation && (
        <InitialConversationField state={initialConversation} connectionId={connectionId} />
      )}
    </div>
  );
}
