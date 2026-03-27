import { useCallback, useSyncExternalStore } from 'react';
import { selectedPrCommentsStore } from '../lib/selectedPrCommentsStore';
import type { PrComment } from '../lib/prCommentsStatus';
import { formatPrCommentsForAgent } from '../lib/formatPrCommentsForAgent';
import { useInjectionSource } from './useInjectionSource';

const INJECTION_SOURCE = 'pr-comments';

/** Subscribe to the selected PR comments for a task. */
export function useSelectedPrComments(taskId: string): PrComment[] {
  return useSyncExternalStore(
    useCallback((listener) => selectedPrCommentsStore.subscribe(taskId, listener), [taskId]),
    useCallback(() => selectedPrCommentsStore.getSnapshot(taskId), [taskId])
  );
}

/**
 * Drives the PR comment → PendingInjectionManager side-effect.
 * Call once, high in the component tree (ChatInterface / MultiAgentTask).
 */
export function usePrCommentInjection(taskId: string) {
  const selected = useSelectedPrComments(taskId);

  const onConsumed = useCallback(() => {
    selectedPrCommentsStore.clear(taskId);
  }, [taskId]);

  useInjectionSource(INJECTION_SOURCE, selected, formatPrCommentsForAgent, onConsumed);
}

/**
 * Lightweight reader for selected PR comment count.
 * Safe to call from any component without duplicating side-effects.
 */
export function useSelectedPrCommentCount(taskId: string): number {
  return useSelectedPrComments(taskId).length;
}
