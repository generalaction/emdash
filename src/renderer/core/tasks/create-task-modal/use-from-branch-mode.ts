import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { rpc } from '@renderer/core/ipc';
import { useTaskSettings } from '@renderer/hooks/useTaskSettings';
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
  });

  const isValid = taskName.taskName.trim().length > 0;

  return {
    ...branchSelection,
    ...taskName,
    isValid,
  };
}
