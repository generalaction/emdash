import { useEffect, useRef } from 'react';
import { refreshCheckRuns, refreshAllSubscribedCheckRuns } from '../lib/checkRunsStore';
import type { CheckRunsStatus } from '../lib/checkRunStatus';

const FAST_POLLING_MS = 10000; // 10s when checks in progress
const SLOW_POLLING_MS = 60000; // 60s when all complete
const COOLDOWN_MS = 3000;

export function useAutoCheckRunsRefresh(
  activeTaskPath: string | undefined,
  checkRunsStatus: CheckRunsStatus | null
): void {
  const lastFocusRefresh = useRef(0);
  const lastVisibilityRefresh = useRef(0);

  // Window focus refresh (all subscribed tasks, debounced)
  useEffect(() => {
    const handleFocus = () => {
      const now = Date.now();
      if (now - lastFocusRefresh.current < COOLDOWN_MS) return;
      lastFocusRefresh.current = now;
      refreshAllSubscribedCheckRuns().catch(() => {});
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  // Adaptive polling for active task
  const allComplete = checkRunsStatus?.allComplete ?? false;

  useEffect(() => {
    if (!activeTaskPath) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const interval = allComplete ? SLOW_POLLING_MS : FAST_POLLING_MS;

    const startPolling = () => {
      if (intervalId) clearInterval(intervalId);
      intervalId = setInterval(() => {
        refreshCheckRuns(activeTaskPath).catch(() => {});
      }, interval);
    };

    const stopPolling = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        const now = Date.now();
        if (now - lastVisibilityRefresh.current >= COOLDOWN_MS) {
          lastVisibilityRefresh.current = now;
          refreshCheckRuns(activeTaskPath).catch(() => {});
        }
        startPolling();
      }
    };

    if (!document.hidden) {
      startPolling();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [activeTaskPath, allComplete]);
}
