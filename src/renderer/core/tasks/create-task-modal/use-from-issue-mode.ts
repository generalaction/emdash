import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Branch, DefaultBranch } from '@shared/git';
import { Issue } from '@shared/tasks';
import { rpc } from '@renderer/core/ipc';
import { useTaskSettings } from '@renderer/hooks/useTaskSettings';
import { useBranchSelection } from './use-branch-selection';
import { useTaskName } from './use-task-name';

export type FromIssueModeState = ReturnType<typeof useFromIssueMode>;

export function useFromIssueMode(
  selectedProjectId: string | undefined,
  branches: Branch[],
  defaultBranch: DefaultBranch | undefined
) {
  const branchSelection = useBranchSelection(selectedProjectId, branches, defaultBranch);
  const [linkedIssue, setLinkedIssue] = useState<Issue | null>(null);
  const { autoGenerateName } = useTaskSettings();

  const shouldGenerate = autoGenerateName && linkedIssue !== null;

  const { data: generatedName, isPending: isGenerating } = useQuery({
    queryKey: ['generateTaskName', linkedIssue?.title ?? null, linkedIssue?.description ?? null],
    queryFn: () =>
      rpc.tasks.generateTaskName({
        title: linkedIssue!.title,
        description: linkedIssue!.description,
      }),
    enabled: shouldGenerate,
    refetchOnWindowFocus: false,
  });

  const taskName = useTaskName({
    generatedName: shouldGenerate ? generatedName : undefined,
    isPending: shouldGenerate && isGenerating,
  });

  const isValid =
    taskName.taskName.trim().length > 0 &&
    linkedIssue !== null &&
    branchSelection.selectedBranch !== undefined &&
    !taskName.isPending;

  return {
    ...branchSelection,
    ...taskName,
    linkedIssue,
    setLinkedIssue,
    isValid,
  };
}
