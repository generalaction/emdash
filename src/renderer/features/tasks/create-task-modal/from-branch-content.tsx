import { Branch } from '@shared/git';
import { BranchPickerField } from './branch-picker-field';
import { TaskNameField } from './task-name-field';
import { FromBranchModeState } from './use-from-branch-mode';

interface FromBranchContentProps {
  state: FromBranchModeState;
  branches: Branch[];
}

export function FromBranchContent({ state, branches }: FromBranchContentProps) {
  return (
    <div className="flex flex-col gap-4">
      <BranchPickerField state={state} branches={branches} />
      <TaskNameField state={state} />
    </div>
  );
}
