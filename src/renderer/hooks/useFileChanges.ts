import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeToFileChanges } from '@/lib/fileChangeEvents';

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
        // Call main process to get git status
        const result = await window.electronAPI.getGitStatus(requestPath);

        if (!mountedRef.current) return;

        if (requestPath !== taskPathRef.current) {
          queueRefresh(true);
          return;
        }

        if (result?.success && result.changes && result.changes.length > 0) {
          const changes: FileChange[] = result.changes
            .map(
              (change: {
                path: string;
                status: string;
                additions: number;
                deletions: number;
                isStaged: boolean;
                diff?: string;
              }) => ({
                path: change.path,
                status: change.status as 'added' | 'modified' | 'deleted' | 'renamed',
                additions: change.additions || 0,
                deletions: change.deletions || 0,
                isStaged: change.isStaged || false,
                diff: change.diff,
              })
            )
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
        // No changes on error - set empty array
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
        void fetchFileChanges(false);
      }
    });

    return () => {
      unsubscribe();
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
