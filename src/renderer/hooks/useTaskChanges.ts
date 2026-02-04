import { useCallback, useEffect, useRef, useState } from 'react';

export interface TaskChange {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  diff?: string;
}

export interface TaskChanges {
  taskId: string;
  changes: TaskChange[];
  totalAdditions: number;
  totalDeletions: number;
  isLoading: boolean;
  error?: string;
}

interface UseTaskChangesOptions {
  isActive?: boolean;
  idleIntervalMs?: number;
}

export function useTaskChanges(
  taskPath: string,
  taskId: string,
  options: UseTaskChangesOptions = {}
) {
  const [changes, setChanges] = useState<TaskChanges>({
    taskId,
    changes: [],
    totalAdditions: 0,
    totalDeletions: 0,
    isLoading: true,
  });
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

  const fetchChanges = useCallback(
    async (isInitialLoad = false) => {
      const currentPath = taskPathRef.current;
      if (!currentPath || inFlightRef.current) return;

      inFlightRef.current = true;
      try {
        if (isInitialLoad) {
          setChanges((prev) => ({ ...prev, isLoading: true, error: undefined }));
        }

        const result = await window.electronAPI.getGitStatus(currentPath);

        if (!mountedRef.current) return;

        if (result.success && result.changes) {
          const filtered = result.changes.filter(
            (c: { path: string }) => !c.path.startsWith('.emdash/') && c.path !== 'PLANNING.md'
          );
          const totalAdditions = filtered.reduce((sum, change) => sum + (change.additions || 0), 0);
          const totalDeletions = filtered.reduce((sum, change) => sum + (change.deletions || 0), 0);

          setChanges({
            taskId,
            changes: filtered,
            totalAdditions,
            totalDeletions,
            isLoading: false,
          });
        } else {
          setChanges({
            taskId,
            changes: [],
            totalAdditions: 0,
            totalDeletions: 0,
            isLoading: false,
            error: result.error || 'Failed to fetch changes',
          });
        }
      } catch (error) {
        if (!mountedRef.current) return;
        setChanges({
          taskId,
          changes: [],
          totalAdditions: 0,
          totalDeletions: 0,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      } finally {
        hasLoadedRef.current = true;
        inFlightRef.current = false;
      }
    },
    [taskId]
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
      void fetchChanges(false);
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
  }, [clearIdleHandle, fetchChanges, idleIntervalMs]);

  const shouldPoll = Boolean(taskPath) && isActive && isDocumentVisible && isWindowFocused;

  useEffect(() => {
    shouldPollRef.current = shouldPoll;
  }, [shouldPoll]);

  useEffect(() => {
    if (!taskPath || !shouldPoll) {
      clearIdleHandle();
      return;
    }

    void fetchChanges(!hasLoadedRef.current);
    scheduleIdleRefresh();

    return () => {
      clearIdleHandle();
    };
  }, [taskPath, shouldPoll, fetchChanges, scheduleIdleRefresh, clearIdleHandle]);

  return {
    ...changes,
  };
}
