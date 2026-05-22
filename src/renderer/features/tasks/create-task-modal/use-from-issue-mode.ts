import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTaskSettings } from '@renderer/features/tasks/hooks/useTaskSettings';
import { refreshLinkedIssueContext } from '@renderer/features/tasks/issue-context/refresh-linked-issue-context';
import { rpc } from '@renderer/lib/ipc';
import { type Branch } from '@shared/git';
import { type Issue } from '@shared/tasks';
import { getIssueTaskName } from './issue-task-name';
import { useBranchName } from './use-branch-name';
import { useBranchSelection } from './use-branch-selection';
import { useTaskName } from './use-task-name';

export type FromIssueModeState = ReturnType<typeof useFromIssueMode>;

export function useFromIssueMode(
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
  const [linkedIssue, setLinkedIssue] = useState<Issue | null>(null);
  const [prevProjectId, setPrevProjectId] = useState(selectedProjectId);
  if (selectedProjectId !== prevProjectId) {
    setPrevProjectId(selectedProjectId);
    setLinkedIssue(null);
  }

  useEffect(() => {
    if (!linkedIssue || linkedIssue.context) return;
    let cancelled = false;
    void refreshLinkedIssueContext(linkedIssue, selectedProjectId).then((enriched) => {
      if (cancelled || enriched === linkedIssue || !enriched.context) return;
      setLinkedIssue((current) =>
        current &&
        current.identifier === enriched.identifier &&
        current.provider === enriched.provider
          ? enriched
          : current
      );
    });
    return () => {
      cancelled = true;
    };
  }, [linkedIssue, selectedProjectId]);
  const { autoGenerateName } = useTaskSettings();
  const generatedTaskNameFromIssue = getIssueTaskName(linkedIssue);

  const shouldGenerate =
    autoGenerateName && linkedIssue !== null && generatedTaskNameFromIssue === null;

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
  });

  const branchNameState = useBranchName({
    taskName: taskName.taskName,
    linkedIssue,
    projectId: selectedProjectId,
    resetKey: selectedProjectId,
  });

  const isValid =
    taskName.taskName.trim().length > 0 &&
    branchNameState.branchName.trim().length > 0 &&
    linkedIssue !== null &&
    branchSelection.selectedBranch !== undefined &&
    !taskName.isPending;

  return {
    ...branchSelection,
    ...taskName,
    ...branchNameState,
    linkedIssue,
    setLinkedIssue,
    isValid,
  };
}
