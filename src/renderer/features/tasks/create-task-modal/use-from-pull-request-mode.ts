import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Branch } from '@shared/git';
import type { PullRequest } from '@shared/pull-requests';
import { useTaskSettings } from '@renderer/features/tasks/hooks/useTaskSettings';
import { rpc } from '@renderer/lib/ipc';
import { useBranchSelection } from './use-branch-selection';
import { useTaskName } from './use-task-name';

export type CheckoutMode = 'checkout' | 'new-branch';

export type FromPullRequestModeState = ReturnType<typeof useFromPullRequestMode>;

export function useFromPullRequestMode(
  selectedProjectId: string | undefined,
  defaultBranch: Branch | undefined,
  isUnborn: boolean,
  initialPR?: PullRequest
) {
  const [linkedPR, setLinkedPR] = useState<PullRequest | null>(initialPR ?? null);
  const [checkoutMode, setCheckoutMode] = useState<CheckoutMode>('checkout');
  const [prevProjectId, setPrevProjectId] = useState(selectedProjectId);
  if (selectedProjectId !== prevProjectId) {
    setPrevProjectId(selectedProjectId);
    setLinkedPR(null);
    setCheckoutMode('checkout');
  }
  const branchSelection = useBranchSelection(selectedProjectId, defaultBranch, isUnborn);
  const { autoGenerateName } = useTaskSettings();

  const shouldGenerate = autoGenerateName && linkedPR !== null;

  const { data: generatedName, isPending: isGenerating } = useQuery({
    queryKey: ['generateTaskName', linkedPR?.title ?? null, linkedPR?.description ?? null],
    queryFn: () =>
      rpc.tasks.generateTaskName({
        title: linkedPR!.title,
        description: linkedPR!.description ?? undefined,
      }),
    enabled: shouldGenerate,
    refetchOnWindowFocus: false,
  });

  const taskName = useTaskName({
    generatedName: shouldGenerate ? generatedName : undefined,
    isPending: shouldGenerate && isGenerating,
    resetKey: selectedProjectId,
  });

  const isValid = taskName.taskName.trim().length > 0 && linkedPR !== null && !taskName.isPending;

  return {
    ...taskName,
    linkedPR,
    setLinkedPR,
    checkoutMode,
    setCheckoutMode,
    branchSelection,
    isValid,
  };
}
