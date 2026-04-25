import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Branch } from '@shared/git';
import { useTaskSettings } from '@renderer/features/tasks/hooks/useTaskSettings';
import { rpc } from '@renderer/lib/ipc';
import { useBranchSelection } from './use-branch-selection';
import { useTaskName } from './use-task-name';

export type FromBranchModeState = ReturnType<typeof useFromBranchMode>;

export function useFromBranchMode(
  selectedProjectId: string | undefined,
  defaultBranch: Branch | undefined,
  isUnborn: boolean,
  currentBranchName?: string | null
) {
  const branchSelection = useBranchSelection(
    selectedProjectId,
    defaultBranch,
    isUnborn,
    currentBranchName
  );
  const { autoGenerateName } = useTaskSettings();

  const stableKey = useMemo(() => crypto.randomUUID(), []);

  const { data: generatedName, isPending: isGenerating } = useQuery({
    queryKey: ['generateTaskName', 'random', stableKey],
    queryFn: () => rpc.tasks.generateTaskName({}),
    enabled: autoGenerateName,
    refetchOnWindowFocus: false,
  });

  const taskName = useTaskName({
    generatedName: autoGenerateName ? generatedName : undefined,
    isPending: autoGenerateName && isGenerating,
    resetKey: selectedProjectId,
  });

  const isValid =
    taskName.taskName.trim().length > 0 &&
    branchSelection.selectedBranch !== undefined &&
    !taskName.isPending;

  return {
    ...branchSelection,
    ...taskName,
    isValid,
  };
}
