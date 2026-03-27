import { useCallback, useState } from 'react';
import { Branch } from '@shared/git';

interface DefaultBranch {
  name: string;
}

export type BranchSelectionState = ReturnType<typeof useBranchSelection>;

export function useBranchSelection(
  selectedProjectId: string | undefined,
  defaultBranch: DefaultBranch | undefined
) {
  // Store the user's branch override alongside the project it belongs to.
  // When the project changes the override is for a different project and is
  // ignored, so defaultBranch takes effect automatically — no effect needed.
  const [branchOverride, setBranchOverride] = useState<
    { projectId: string; branch: Branch } | undefined
  >(undefined);

  const selectedBranch: Branch | undefined =
    branchOverride !== undefined && branchOverride.projectId === selectedProjectId
      ? branchOverride.branch
      : defaultBranch
        ? { type: 'local', branch: defaultBranch.name }
        : undefined;

  const setSelectedBranch = useCallback(
    (branch: Branch | undefined) => {
      if (!selectedProjectId || !branch) {
        setBranchOverride(undefined);
        return;
      }
      setBranchOverride({ projectId: selectedProjectId, branch });
    },
    [selectedProjectId]
  );

  const [createBranchAndWorktree, setCreateBranchAndWorktree] = useState(true);
  const [pushBranch, setPushBranch] = useState(false);

  return {
    selectedBranch,
    setSelectedBranch,
    createBranchAndWorktree,
    setCreateBranchAndWorktree,
    pushBranch,
    setPushBranch,
  };
}
