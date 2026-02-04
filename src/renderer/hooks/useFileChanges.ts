import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeToFileChanges } from '@/lib/fileChangeEvents';
import { getCachedGitStatus } from '@/lib/gitStatusCache';

export interface FileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  isStaged: boolean;
  diff?: string;
}

interface UseFileChangesOptions {
  isActive?: boolean;
  idleIntervalMs?: number;
}

export function useFileChanges(taskPath?: string, options: UseFileChangesOptions = {}) {
  const [fileChanges, setFileChanges] = useState<FileChange[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDocumentVisible, setIsDocumentVisible] = useState(() => {
    if (typeof document === 'undefined') return true;
    return document.visibilityState === 'visible';
  });
  const [isWindowFocused, setIsWindowFocused] = useState(() => {
    if (typeof document === 'undefined') return true;
    return document.hasFocus();
  });

  const { isActive = true, idleIntervalMs = 60000 } = options;
  const taskPathRef = useRef(taskPath);
  const inFlightRef = useRef(false);
  const hasLoadedRef = useRef(false);
  const shouldPollRef = useRef(false);
  const idleHandleRef = useRef<number | null>(null);
  const idleHandleModeRef = useRef<'idle' | 'timeout' | null>(null);
  const mountedRef = useRef(true);
  const pendingRefreshRef = useRef(false);
  const pendingInitialLoadRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    taskPathRef.current = taskPath;
    hasLoadedRef.current = false;
  }, [taskPath]);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    const handleVisibility = () => {
      setIsDocumentVisible(document.visibilityState === 'visible');
    };
    const handleFocus = () => setIsWindowFocused(true);
    const handleBlur = () => setIsWindowFocused(false);

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  const queueRefresh = useCallback((shouldSetLoading: boolean) => {
    pendingRefreshRef.current = true;
    if (shouldSetLoading) {
      pendingInitialLoadRef.current = true;
      if (mountedRef.current) {
        setIsLoading(true);
        setError(null);
      }
    }
  }, []);

  const fetchFileChanges = useCallback(
    async (isInitialLoad = false, options?: { force?: boolean }) => {
      const currentPath = taskPathRef.current;
      if (!currentPath) return;

      if (inFlightRef.current) {
        if (options?.force) {
          queueRefresh(isInitialLoad);
        }
        return;
      }

      inFlightRef.current = true;
      if (isInitialLoad && mountedRef.current) {
        setIsLoading(true);
        setError(null);
      }

      const requestPath = currentPath;

      try {
        const result = await getCachedGitStatus(requestPath, { force: options?.force });

        if (!mountedRef.current) return;

        if (requestPath !== taskPathRef.current) {
          queueRefresh(true);
          return;
        }

        if (result?.success && result.changes && result.changes.length > 0) {
          const changes: FileChange[] = result.changes
            .map((change) => ({
              path: change.path,
              status: change.status as 'added' | 'modified' | 'deleted' | 'renamed',
              additions: change.additions || 0,
              deletions: change.deletions || 0,
              isStaged: change.isStaged || false,
              diff: change.diff,
            }))
            .filter((c) => !c.path.startsWith('.emdash/') && c.path !== 'PLANNING.md');
          setFileChanges(changes);
        } else {
          setFileChanges([]);
        }
      } catch (err) {
        if (!mountedRef.current) return;
        if (requestPath !== taskPathRef.current) {
          queueRefresh(true);
          return;
        }
        console.error('Failed to fetch file changes:', err);
        if (isInitialLoad) {
          setError('Failed to load file changes');
        }
        setFileChanges([]);
      } finally {
        const isCurrentPath = requestPath === taskPathRef.current;
        if (mountedRef.current && isInitialLoad && !pendingInitialLoadRef.current) {
          setIsLoading(false);
        }
        if (isCurrentPath) {
          hasLoadedRef.current = true;
        }
        inFlightRef.current = false;

        if (pendingRefreshRef.current) {
          const nextInitialLoad = pendingInitialLoadRef.current;
          pendingRefreshRef.current = false;
          pendingInitialLoadRef.current = false;
          void fetchFileChanges(nextInitialLoad, { force: true });
        }
      }
    },
    [queueRefresh]
  );

  const clearIdleHandle = useCallback(() => {
    if (idleHandleRef.current === null) return;
    if (idleHandleModeRef.current === 'idle') {
      const cancelIdle = (window as any).cancelIdleCallback as ((id: number) => void) | undefined;
      cancelIdle?.(idleHandleRef.current);
    } else {
      clearTimeout(idleHandleRef.current);
    }
    idleHandleRef.current = null;
    idleHandleModeRef.current = null;
  }, []);

  const scheduleIdleRefresh = useCallback(() => {
    if (!shouldPollRef.current) return;
    clearIdleHandle();

    const run = () => {
      if (!shouldPollRef.current) return;
      void fetchFileChanges(false);
      scheduleIdleRefresh();
    };

    const requestIdle = (window as any).requestIdleCallback as
      | ((cb: () => void, options?: { timeout: number }) => number)
      | undefined;

    if (requestIdle) {
      idleHandleModeRef.current = 'idle';
      idleHandleRef.current = requestIdle(run, { timeout: idleIntervalMs });
    } else {
      idleHandleModeRef.current = 'timeout';
      idleHandleRef.current = window.setTimeout(run, idleIntervalMs);
    }
  }, [clearIdleHandle, fetchFileChanges, idleIntervalMs]);

  const shouldPoll = Boolean(taskPath) && isActive && isDocumentVisible && isWindowFocused;

  useEffect(() => {
    shouldPollRef.current = shouldPoll;
  }, [shouldPoll]);

  useEffect(() => {
    if (!taskPath || !shouldPoll) {
      clearIdleHandle();
      return;
    }

    void fetchFileChanges(!hasLoadedRef.current);
    scheduleIdleRefresh();

    return () => {
      clearIdleHandle();
    };
  }, [taskPath, shouldPoll, fetchFileChanges, scheduleIdleRefresh, clearIdleHandle]);

  useEffect(() => {
    if (!taskPath) return undefined;

    const unsubscribe = subscribeToFileChanges((event) => {
      if (event.detail.taskPath === taskPath && shouldPollRef.current) {
        void fetchFileChanges(false, { force: true });
      }
    });

    return () => {
      unsubscribe();
    };
  }, [taskPath, fetchFileChanges]);

  useEffect(() => {
    if (!taskPath) return;
    const api = window.electronAPI;
    let off: (() => void) | undefined;
    let watchId: string | undefined;
    let disposed = false;

    const watchPromise = api.watchGitStatus
      ? api.watchGitStatus(taskPath)
      : Promise.resolve({ success: false });

    watchPromise
      .then((res: { success?: boolean; watchId?: string }) => {
        if (disposed) {
          if (res?.success && res.watchId && api.unwatchGitStatus) {
            api.unwatchGitStatus(taskPath, res.watchId).catch(() => {});
          }
          return;
        }
        if (!res?.success) {
          return;
        }
        watchId = res.watchId;
        if (api.onGitStatusChanged) {
          off = api.onGitStatusChanged((event) => {
            if (event?.taskPath !== taskPath) return;
            if (!shouldPollRef.current) return;
            void fetchFileChanges(false, { force: true });
          });
        }
      })
      .catch(() => {});

    return () => {
      disposed = true;
      off?.();
      if (api.unwatchGitStatus && watchId) {
        api.unwatchGitStatus(taskPath, watchId).catch(() => {});
      }
    };
  }, [taskPath, fetchFileChanges]);

  const refreshChanges = async () => {
    await fetchFileChanges(true, { force: true });
  };

  return {
    fileChanges,
    isLoading,
    error,
    refreshChanges,
  };
}
