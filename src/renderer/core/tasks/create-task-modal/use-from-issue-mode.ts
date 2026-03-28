import { useState } from 'react';
import { Issue } from '@shared/tasks';
import { useBranchSelection } from './use-branch-selection';
import { useTaskName } from './use-task-name';

interface DefaultBranch {
  name: string;
}

export type FromIssueModeState = ReturnType<typeof useFromIssueMode>;

export function useFromIssueMode(
  selectedProjectId: string | undefined,
  defaultBranch: DefaultBranch | undefined
) {
  const branchSelection = useBranchSelection(selectedProjectId, defaultBranch);
  const taskName = useTaskName();
  const [linkedIssue, setLinkedIssue] = useState<Issue | null>(null);

  return {
    ...branchSelection,
    ...taskName,
    linkedIssue,
    setLinkedIssue,
  };
}
