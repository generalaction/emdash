import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTaskSettings } from '@renderer/features/tasks/hooks/useTaskSettings';
import { rpc } from '@renderer/lib/ipc';
import { useTaskName } from './use-task-name';

export type NoGitModeState = ReturnType<typeof useNoGitMode>;

export function useNoGitMode(selectedProjectId: string | undefined, isActive: boolean) {
  const { autoGenerateName } = useTaskSettings();
  const stableKey = useMemo(() => crypto.randomUUID(), []);

  const { data: generatedName, isPending: isGenerating } = useQuery({
    queryKey: ['generateTaskName', 'random', stableKey],
    queryFn: () => rpc.tasks.generateTaskName({}),
    enabled: autoGenerateName && isActive,
    refetchOnWindowFocus: false,
  });

  const taskName = useTaskName({
    generatedName: autoGenerateName ? generatedName : undefined,
    isPending: autoGenerateName && isActive && isGenerating,
    resetKey: selectedProjectId,
  });

  const isValid = taskName.taskName.trim().length > 0 && !taskName.isPending;

  return { ...taskName, isValid };
}
