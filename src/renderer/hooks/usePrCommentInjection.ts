import { useEffect, useRef, useSyncExternalStore } from 'react';
import { selectedPrCommentsStore } from '../lib/selectedPrCommentsStore';
import { pendingInjectionManager } from '../lib/PendingInjectionManager';
import { formatPrCommentsForAgent } from '../lib/formatPrCommentsForAgent';

const INJECTION_SOURCE = 'pr-comments';

const subscribe = (listener: () => void) => selectedPrCommentsStore.subscribe(listener);
const getSnapshot = () => selectedPrCommentsStore.getSnapshot();

/**
 * Drives the PR comment → PendingInjectionManager side-effect.
 * Call once, high in the component tree (ChatInterface / MultiAgentTask).
 */
export function usePrCommentInjection() {
  const selected = useSyncExternalStore(subscribe, getSnapshot);
  const hasPendingRef = useRef(false);

  useEffect(() => {
    if (selected.length === 0) {
      if (hasPendingRef.current) {
        pendingInjectionManager.clear(INJECTION_SOURCE);
        hasPendingRef.current = false;
      }
      return () => {
        if (hasPendingRef.current) {
          pendingInjectionManager.clear(INJECTION_SOURCE);
          hasPendingRef.current = false;
        }
      };
    }

    const formatted = formatPrCommentsForAgent(selected);
    if (formatted) {
      pendingInjectionManager.setPending(formatted, INJECTION_SOURCE);
      hasPendingRef.current = true;
    }

    return () => {
      if (hasPendingRef.current) {
        pendingInjectionManager.clear(INJECTION_SOURCE);
        hasPendingRef.current = false;
      }
    };
  }, [selected]);

  useEffect(() => {
    return pendingInjectionManager.onInjectionUsed(() => {
      selectedPrCommentsStore.clear();
      hasPendingRef.current = false;
    });
  }, []);
}

/**
 * Lightweight reader for selected PR comment count.
 * Safe to call from any component without duplicating side-effects.
 */
export function useSelectedPrCommentCount(): number {
  const selected = useSyncExternalStore(subscribe, getSnapshot);
  return selected.length;
}
