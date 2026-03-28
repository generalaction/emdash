import { useBranchSelection } from './use-branch-selection';
import { useTaskName } from './use-task-name';

interface DefaultBranch {
  name: string;
}

export type FromBranchModeState = ReturnType<typeof useFromBranchMode>;

export function useFromBranchMode(
  selectedProjectId: string | undefined,
  defaultBranch: DefaultBranch | undefined
) {
  const branchSelection = useBranchSelection(selectedProjectId, defaultBranch);
  const taskName = useTaskName();

  return {
    ...branchSelection,
    ...taskName,
  };
}
