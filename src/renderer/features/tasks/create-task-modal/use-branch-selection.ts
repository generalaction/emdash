import { useCallback, useState } from 'react';
import type { Branch } from '@shared/git';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';

export type BranchSelectionState = ReturnType<typeof useBranchSelection>;

export function resolveDefaultSelectedBranch(
  branches: Branch[],
  defaultBranchName: string | undefined
): Branch | undefined {
  if (!defaultBranchName) return undefined;

  const local = branches.find(
    (branch) => branch.type === 'local' && branch.branch === defaultBranchName
  );
  if (local) return local;

  const remoteAny = branches.find(
    (branch) => branch.type === 'remote' && branch.branch === defaultBranchName
  );
  if (remoteAny) return remoteAny;

  return undefined;
}

export function useBranchSelection(
  selectedProjectId: string | undefined,
  branches: Branch[],
  defaultBranchName: string | undefined,
  isUnborn: boolean
) {
  const { value: localProject } = useAppSettingsKey('localProject');
  const pushOnCreateByDefault = localProject?.pushOnCreate ?? true;

  // Store the user's branch override alongside the project it belongs to.
  // When the project changes the override is for a different project and is
  // ignored, so defaultBranch takes effect automatically — no effect needed.
  const [branchOverride, setBranchOverride] = useState<
    { projectId: string; branch: Branch } | undefined
  >(undefined);

  const selectedBranch: Branch | undefined =
    branchOverride !== undefined && branchOverride.projectId === selectedProjectId
      ? branchOverride.branch
      : resolveDefaultSelectedBranch(branches, defaultBranchName);

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

  const [createBranchAndWorktreePreference, setCreateBranchAndWorktreePreference] = useState(true);
  const [pushBranchOverride, setPushBranchOverride] = useState<boolean | undefined>(undefined);
  const pushBranch = pushBranchOverride ?? pushOnCreateByDefault;
  const createBranchAndWorktree = isUnborn ? false : createBranchAndWorktreePreference;
  const setPushBranch = useCallback((value: boolean) => {
    setPushBranchOverride(value);
  }, []);
  const setCreateBranchAndWorktree = useCallback(
    (value: boolean) => {
      if (isUnborn) return;
      setCreateBranchAndWorktreePreference(value);
    },
    [isUnborn]
  );

  return {
    selectedBranch,
    setSelectedBranch,
    createBranchAndWorktree,
    setCreateBranchAndWorktree,
    pushBranch,
    setPushBranch,
  };
}
