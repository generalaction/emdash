import { BranchPickerField } from './branch-picker-field';
import { TaskNameField } from './task-name-field';
import { FromBranchModeState } from './use-from-branch-mode';

interface FromBranchContentProps {
  state: FromBranchModeState;
  projectId?: string;
  currentBranch?: string | null;
  isUnborn?: boolean;
}

export function FromBranchContent({
  state,
  projectId,
  currentBranch,
  isUnborn,
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
    </div>
  );
}
