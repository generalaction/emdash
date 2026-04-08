import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Branch, DefaultBranch } from '@shared/git';
import type { PullRequest } from '@shared/pull-requests';
import { rpc } from '@renderer/core/ipc';
import { useTaskSettings } from '@renderer/hooks/useTaskSettings';
import { useBranchSelection } from './use-branch-selection';
import { useTaskName } from './use-task-name';

export type CheckoutMode = 'checkout' | 'new-branch';

export type FromPullRequestModeState = ReturnType<typeof useFromPullRequestMode>;

export function useFromPullRequestMode(
  selectedProjectId: string | undefined,
  branches: Branch[],
  defaultBranch: DefaultBranch | undefined,
  initialPR?: PullRequest
) {
  const [linkedPR, setLinkedPR] = useState<PullRequest | null>(initialPR ?? null);
  const [checkoutMode, setCheckoutMode] = useState<CheckoutMode>('checkout');
  const branchSelection = useBranchSelection(selectedProjectId, branches, defaultBranch);
  const { autoGenerateName } = useTaskSettings();

  const shouldGenerate = autoGenerateName && linkedPR !== null;

  const { data: generatedName, isPending: isGenerating } = useQuery({
    queryKey: ['generateTaskName', linkedPR?.title ?? null, linkedPR?.metadata.body ?? null],
    queryFn: () =>
      rpc.tasks.generateTaskName({
        title: linkedPR!.title,
        description: linkedPR!.metadata.body ?? undefined,
      }),
    enabled: shouldGenerate,
    refetchOnWindowFocus: false,
  });

  const taskName = useTaskName({
    generatedName: shouldGenerate ? generatedName : undefined,
    isPending: shouldGenerate && isGenerating,
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
