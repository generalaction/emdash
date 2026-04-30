import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Branch } from '@shared/git';
import { Issue } from '@shared/tasks';
import { useTaskSettings } from '@renderer/features/tasks/hooks/useTaskSettings';
import { rpc } from '@renderer/lib/ipc';
import { getIssueTaskName } from './issue-task-name';
import { useBranchSelection, type BranchSelectionInitial } from './use-branch-selection';
import { useTaskName } from './use-task-name';

export type FromIssueModeState = ReturnType<typeof useFromIssueMode>;

export type FromIssueModeInitial = BranchSelectionInitial & {
  taskName?: string;
  linkedIssue?: Issue;
};

export function useFromIssueMode(
  selectedProjectId: string | undefined,
  defaultBranch: Branch | undefined,
  isUnborn: boolean,
  currentBranchName?: string | null,
  initial?: FromIssueModeInitial
) {
  const branchSelection = useBranchSelection(
    selectedProjectId,
    defaultBranch,
    isUnborn,
    currentBranchName,
    initial
  );
  const [linkedIssue, setLinkedIssue] = useState<Issue | null>(initial?.linkedIssue ?? null);
  const [prevProjectId, setPrevProjectId] = useState(selectedProjectId);
  if (selectedProjectId !== prevProjectId) {
    setPrevProjectId(selectedProjectId);
    setLinkedIssue(null);
  }
  const { autoGenerateName } = useTaskSettings();
  const generatedTaskNameFromIssue = getIssueTaskName(linkedIssue);

  const shouldGenerate =
    autoGenerateName &&
    linkedIssue !== null &&
    generatedTaskNameFromIssue === null &&
    !initial?.taskName;

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
    generatedName: generatedTaskNameFromIssue ?? (shouldGenerate ? generatedName : undefined),
    isPending: shouldGenerate && isGenerating,
    resetKey: selectedProjectId,
    initialName: initial?.taskName,
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
