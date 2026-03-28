import { useState } from 'react';
import type { PullRequest } from '@shared/pull-requests';
import { useTaskName } from './use-task-name';

export type CheckoutMode = 'checkout' | 'new-branch';

export type FromPullRequestModeState = ReturnType<typeof useFromPullRequestMode>;

export function useFromPullRequestMode() {
  const taskName = useTaskName();
  const [linkedPR, setLinkedPR] = useState<PullRequest | null>(null);
  const [checkoutMode, setCheckoutMode] = useState<CheckoutMode>('checkout');

  return { ...taskName, linkedPR, setLinkedPR, checkoutMode, setCheckoutMode };
}
