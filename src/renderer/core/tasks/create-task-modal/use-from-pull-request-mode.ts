import { useState } from 'react';
import { DefaultBranch } from '@shared/git';
import type { PullRequest } from '@shared/pull-requests';
import { useBranchSelection } from './use-branch-selection';
import { useTaskName } from './use-task-name';

export type CheckoutMode = 'checkout' | 'new-branch';

export type FromPullRequestModeState = ReturnType<typeof useFromPullRequestMode>;

export function useFromPullRequestMode(
  selectedProjectId: string | undefined,
  defaultBranch: DefaultBranch | undefined
) {
  const taskName = useTaskName();
  const [linkedPR, setLinkedPR] = useState<PullRequest | null>(null);
  const [checkoutMode, setCheckoutMode] = useState<CheckoutMode>('checkout');
  const branchSelection = useBranchSelection(selectedProjectId, defaultBranch);

  return { ...taskName, linkedPR, setLinkedPR, checkoutMode, setCheckoutMode, branchSelection };
}
