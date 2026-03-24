import { useCallback, useEffect, useRef, useState } from 'react';
import { getCachedGitStatus } from '@/lib/gitStatusCache';
import { filterVisibleGitStatusChanges } from '@/lib/gitStatusFilters';
import { useGitStatusAutoRefresh } from '@/hooks/internal/useGitStatusAutoRefresh';

export interface TaskChange {
  path: string;
  status: string;
  additions: number | null;
  deletions: number | null;
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
        setChanges((prev) => ({ ...prev, isLoading: true, error: undefined }));
      }
    }
  }, []);

  const fetchChanges = useCallback(
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
      try {
        if (isInitialLoad) {
          setChanges((prev) => ({ ...prev, isLoading: true, error: undefined }));
        }

        const requestPath = currentPath;
        const result = await getCachedGitStatus(requestPath, { force: options?.force });

        if (!mountedRef.current) return;

        if (requestPath !== taskPathRef.current) {
          queueRefresh(true);
          return;
        }

        if (result?.success && result.changes) {
          const filtered = filterVisibleGitStatusChanges(result.changes);
          const totalAdditions = filtered.reduce((sum, change) => sum + (change.additions ?? 0), 0);
          const totalDeletions = filtered.reduce((sum, change) => sum + (change.deletions ?? 0), 0);

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
            error: result?.error || 'Failed to fetch changes',
          });
        }
      } catch (error) {
        if (!mountedRef.current) return;
        if (currentPath !== taskPathRef.current) {
          queueRefresh(true);
          return;
        }
        setChanges({
          taskId,
          changes: [],
          totalAdditions: 0,
          totalDeletions: 0,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      } finally {
        const isCurrentPath = currentPath === taskPathRef.current;
        if (isCurrentPath) {
          hasLoadedRef.current = true;
        }
        inFlightRef.current = false;

        if (pendingRefreshRef.current) {
          const nextInitialLoad = pendingInitialLoadRef.current;
          pendingRefreshRef.current = false;
          pendingInitialLoadRef.current = false;
          void fetchChanges(nextInitialLoad, { force: true });
        }
      }
    },
    [taskId, queueRefresh]
  );

  const shouldPoll = Boolean(taskPath) && isActive && isDocumentVisible && isWindowFocused;
  useGitStatusAutoRefresh({
    taskPath,
    shouldPoll,
    idleIntervalMs,
    hasLoadedRef,
    fetchChanges,
  });

  return {
    ...changes,
  };
}
