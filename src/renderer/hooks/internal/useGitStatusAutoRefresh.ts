import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';

type IdleCallbackWindow = Window &
  typeof globalThis & {
    requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };

interface FetchOptions {
  force?: boolean;
}

interface WatcherRefreshOptions {
  immediate?: boolean;
  force?: boolean;
}

interface UseGitStatusAutoRefreshParams {
  taskPath?: string;
  taskId?: string;
  shouldPoll: boolean;
  idleIntervalMs: number;
  hasLoadedRef: MutableRefObject<boolean>;
  fetchChanges: (isInitialLoad?: boolean, options?: FetchOptions) => Promise<void>;
  watchRefreshDebounceMs?: number;
  minForceRefreshIntervalMs?: number;
}

interface UseGitStatusAutoRefreshResult {
  shouldPollRef: MutableRefObject<boolean>;
  scheduleWatcherRefresh: (options?: WatcherRefreshOptions) => void;
  clearScheduledRefresh: () => void;
}

const DEFAULT_WATCH_REFRESH_DEBOUNCE_MS = 120;
const DEFAULT_MIN_FORCE_REFRESH_INTERVAL_MS = 300;

export function useGitStatusAutoRefresh({
  taskPath,
  taskId,
  shouldPoll,
  idleIntervalMs,
  hasLoadedRef,
  fetchChanges,
  watchRefreshDebounceMs = DEFAULT_WATCH_REFRESH_DEBOUNCE_MS,
  minForceRefreshIntervalMs = DEFAULT_MIN_FORCE_REFRESH_INTERVAL_MS,
}: UseGitStatusAutoRefreshParams): UseGitStatusAutoRefreshResult {
  const shouldPollRef = useRef(false);
  const idleHandleRef = useRef<number | null>(null);
  const idleHandleModeRef = useRef<'idle' | 'timeout' | null>(null);
  const scheduledRefreshTimerRef = useRef<number | null>(null);
  const lastForcedRefreshAtRef = useRef(0);

  const clearIdleHandle = useCallback(() => {
    if (idleHandleRef.current === null) return;
    if (idleHandleModeRef.current === 'idle') {
      const cancelIdle = (window as IdleCallbackWindow).cancelIdleCallback;
      cancelIdle?.(idleHandleRef.current);
    } else {
      clearTimeout(idleHandleRef.current);
    }
    idleHandleRef.current = null;
    idleHandleModeRef.current = null;
  }, []);

  const clearScheduledRefresh = useCallback(() => {
    if (scheduledRefreshTimerRef.current === null) return;
    clearTimeout(scheduledRefreshTimerRef.current);
    scheduledRefreshTimerRef.current = null;
  }, []);

  const scheduleWatcherRefresh = useCallback(
    (options?: WatcherRefreshOptions) => {
      if (!shouldPollRef.current) return;

      const immediate = options?.immediate ?? false;
      const requestedForce = options?.force ?? true;

      const runRefresh = () => {
        scheduledRefreshTimerRef.current = null;
        const now = Date.now();
        const allowForce =
          requestedForce && now - lastForcedRefreshAtRef.current >= minForceRefreshIntervalMs;
        if (allowForce) {
          lastForcedRefreshAtRef.current = now;
        }
        void fetchChanges(false, { force: allowForce });
      };

      if (immediate) {
        clearScheduledRefresh();
        runRefresh();
        return;
      }

      clearScheduledRefresh();
      scheduledRefreshTimerRef.current = window.setTimeout(runRefresh, watchRefreshDebounceMs);
    },
    [clearScheduledRefresh, fetchChanges, minForceRefreshIntervalMs, watchRefreshDebounceMs]
  );

  const scheduleIdleRefresh = useCallback(() => {
    if (!shouldPollRef.current) return;
    clearIdleHandle();

    const armNextRefresh = () => {
      const run = () => {
        if (!shouldPollRef.current) return;
        void fetchChanges(false);
        armNextRefresh();
      };

      const requestIdle = (window as IdleCallbackWindow).requestIdleCallback;
      if (requestIdle) {
        idleHandleModeRef.current = 'idle';
        idleHandleRef.current = requestIdle(run, { timeout: idleIntervalMs });
      } else {
        idleHandleModeRef.current = 'timeout';
        idleHandleRef.current = window.setTimeout(run, idleIntervalMs);
      }
    };

    armNextRefresh();
  }, [clearIdleHandle, fetchChanges, idleIntervalMs]);

  useEffect(() => {
    shouldPollRef.current = shouldPoll;
  }, [shouldPoll]);

  useEffect(() => {
    if (!taskPath || !shouldPoll) {
      clearIdleHandle();
      clearScheduledRefresh();
      return;
    }

    void fetchChanges(!hasLoadedRef.current);
    scheduleIdleRefresh();

    return () => {
      clearIdleHandle();
      clearScheduledRefresh();
    };
  }, [
    taskPath,
    shouldPoll,
    fetchChanges,
    hasLoadedRef,
    scheduleIdleRefresh,
    clearIdleHandle,
    clearScheduledRefresh,
  ]);

  useEffect(() => {
    if (!taskPath) return;
    const api = window.electronAPI;
    let off: (() => void) | undefined;
    let watchId: string | undefined;
    let disposed = false;

    const watchArg = taskId ? { taskPath, taskId } : taskPath;
    const watchPromise = api.watchGitStatus
      ? api.watchGitStatus(watchArg)
      : Promise.resolve({ success: false });

    watchPromise
      .then((res: { success?: boolean; watchId?: string }) => {
        if (disposed) {
          if (res?.success && res.watchId && api.unwatchGitStatus) {
            api.unwatchGitStatus(watchArg, res.watchId).catch(() => {});
          }
          return;
        }
        if (!res?.success) return;

        watchId = res.watchId;
        if (api.onGitStatusChanged) {
          off = api.onGitStatusChanged((event) => {
            if (event?.taskPath !== taskPath) return;
            if (!shouldPollRef.current) return;
            if (event?.error === 'watcher-error') {
              scheduleWatcherRefresh({ immediate: true, force: true });
              return;
            }
            scheduleWatcherRefresh({ force: true });
          });
        }
      })
      .catch(() => {});

    return () => {
      disposed = true;
      off?.();
      if (api.unwatchGitStatus && watchId) {
        api.unwatchGitStatus(watchArg, watchId).catch(() => {});
      }
    };
  }, [taskPath, taskId, scheduleWatcherRefresh]);

  return {
    shouldPollRef,
    scheduleWatcherRefresh,
    clearScheduledRefresh,
  };
}
