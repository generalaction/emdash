import { Branch } from '@shared/git';
import { BranchPickerField } from './branch-picker-field';
import { TaskNameField } from './task-name-field';
import { FromBranchModeState } from './use-from-branch-mode';

interface FromBranchContentProps {
  state: FromBranchModeState;
  branches: Branch[];
  isUnborn?: boolean;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export function FromBranchContent({
  state,
  branches,
  isUnborn,
  onRefresh,
  isRefreshing,
}: FromBranchContentProps) {
  return (
    <div className="flex flex-col gap-4">
      <BranchPickerField
        state={state}
        branches={branches}
        isUnborn={isUnborn}
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
      />
      <TaskNameField state={state} />
    </div>
  );
}
