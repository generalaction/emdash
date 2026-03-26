import { useCallback, useSyncExternalStore } from 'react';
import { selectedPrCommentsStore } from '../lib/selectedPrCommentsStore';
import { formatPrCommentsForAgent } from '../lib/formatPrCommentsForAgent';
import { useInjectionSource } from './useInjectionSource';

const INJECTION_SOURCE = 'pr-comments';

const subscribe = (listener: () => void) => selectedPrCommentsStore.subscribe(listener);
const getSnapshot = () => selectedPrCommentsStore.getSnapshot();

/**
 * Drives the PR comment → PendingInjectionManager side-effect.
 * Call once, high in the component tree (ChatInterface / MultiAgentTask).
 */
export function usePrCommentInjection() {
  const selected = useSyncExternalStore(subscribe, getSnapshot);

  const onConsumed = useCallback(() => {
    selectedPrCommentsStore.clear();
  }, []);

  useInjectionSource(INJECTION_SOURCE, selected, formatPrCommentsForAgent, onConsumed);
}

/**
 * Lightweight reader for selected PR comment count.
 * Safe to call from any component without duplicating side-effects.
 */
export function useSelectedPrCommentCount(): number {
  const selected = useSyncExternalStore(subscribe, getSnapshot);
  return selected.length;
}
