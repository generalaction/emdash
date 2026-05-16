import { useCallback, useEffect, useRef } from 'react';
import { appState } from '@renderer/lib/stores/app-state';

const SHOW_DELAY_MS = 150;

/**
 * Drives the TaskSwitcherStore via Ctrl+Tab keydown/keyup events.
 * Shows the tab switcher overlay after a short delay if the user holds Ctrl.
 * Navigates on Ctrl release.
 */
export function useTaskSwitcherShortcut(
  enabled: boolean,
  currentTaskId: string | undefined,
  navigate: (target: { projectId: string; taskId: string }) => void
): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  });

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const store = appState.taskSwitcher;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && store.isCycling) {
        e.preventDefault();
        e.stopPropagation();
        clearTimer();
        store.cancel();
        return;
      }
      if (e.key !== 'Tab' || !e.ctrlKey) return;
      e.preventDefault();
      e.stopPropagation();

      if (!store.isCycling) {
        const started = store.startCycle(currentTaskId);
        if (!started) return;
        timerRef.current = setTimeout(() => {
          if (store.isCycling) store.show();
        }, SHOW_DELAY_MS);
      } else {
        store.advance(e.shiftKey ? -1 : 1);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== 'Control' || !store.isCycling) return;
      clearTimer();
      const target = store.commit();
      if (target) navigateRef.current(target);
    };

    const onBlur = () => {
      if (!store.isCycling) return;
      clearTimer();
      store.cancel();
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
      clearTimer();
      if (store.isCycling) store.cancel();
    };
  }, [enabled, currentTaskId, clearTimer]);
}
