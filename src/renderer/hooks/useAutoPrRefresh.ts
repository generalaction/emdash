import { useEffect, useRef } from 'react';
import { refreshPrStatus, refreshAllSubscribedPrStatus } from '../lib/prStatusStore';

const POLLING_INTERVAL_MS = 30000; // 30 seconds
const COOLDOWN_MS = 5000; // 5 second debounce for rapid focus/visibility events

/**
 * Auto-refreshes PR status via:
 * 1. Window focus - refreshes all subscribed tasks (debounced)
 * 2. Polling - refreshes active task every 30s (pauses when hidden)
 * 3. PTY PR URL events - refreshes immediately when terminal output includes a PR link
 */
export function useAutoPrRefresh(activeTaskPath: string | undefined): void {
  const lastFocusRefresh = useRef(0);
  const lastVisibilityRefresh = useRef(0);

  // Event-driven refresh when terminal output includes a GitHub PR URL
  useEffect(() => {
    const unsubscribe = window.electronAPI.onPtyPrUrlDetected?.((event) => {
      // Skip SSH PTYs where cwd is undefined to avoid refreshing wrong task
      if (!event?.cwd) return;
      refreshPrStatus(event.cwd).catch(() => {});
    });

    return () => {
      unsubscribe?.();
    };
  }, []);

  // Window focus refresh (all subscribed tasks, debounced)
  useEffect(() => {
    const handleFocus = () => {
      const now = Date.now();
      if (now - lastFocusRefresh.current < COOLDOWN_MS) return;
      lastFocusRefresh.current = now;
      refreshAllSubscribedPrStatus().catch(() => {});
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  // Polling for active task (pauses when window hidden)
  useEffect(() => {
    if (!activeTaskPath) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (intervalId) return;
      intervalId = setInterval(() => {
        refreshPrStatus(activeTaskPath).catch(() => {});
      }, POLLING_INTERVAL_MS);
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
          refreshPrStatus(activeTaskPath).catch(() => {});
        }
        startPolling();
      }
    };

    // Start polling if visible
    if (!document.hidden) {
      startPolling();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [activeTaskPath]);
}
