import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Branch } from '@shared/git';
import { useTaskSettings } from '@renderer/features/tasks/hooks/useTaskSettings';
import { rpc } from '@renderer/lib/ipc';
import { useBranchSelection, type BranchSelectionInitial } from './use-branch-selection';
import { useTaskName } from './use-task-name';

export type FromBranchModeState = ReturnType<typeof useFromBranchMode>;

export type FromBranchModeInitial = BranchSelectionInitial & {
  taskName?: string;
};

export function useFromBranchMode(
  selectedProjectId: string | undefined,
  defaultBranch: Branch | undefined,
  isUnborn: boolean,
  currentBranchName?: string | null,
  initial?: FromBranchModeInitial
) {
  const branchSelection = useBranchSelection(
    selectedProjectId,
    defaultBranch,
    isUnborn,
    currentBranchName,
    initial
  );
  const { autoGenerateName } = useTaskSettings();

  const stableKey = useMemo(() => crypto.randomUUID(), []);

  const shouldAutoGenerate = autoGenerateName && !initial?.taskName;

  const { data: generatedName, isPending: isGenerating } = useQuery({
    queryKey: ['generateTaskName', 'random', stableKey],
    queryFn: () => rpc.tasks.generateTaskName({}),
    enabled: shouldAutoGenerate,
    refetchOnWindowFocus: false,
  });

  const taskName = useTaskName({
    generatedName: shouldAutoGenerate ? generatedName : undefined,
    isPending: shouldAutoGenerate && isGenerating,
    resetKey: selectedProjectId,
    initialName: initial?.taskName,
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
