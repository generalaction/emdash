import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeToFileChanges } from '@/lib/fileChangeEvents';
import { getCachedGitStatus } from '@/lib/gitStatusCache';
import { filterVisibleGitStatusChanges } from '@/lib/gitStatusFilters';
import { useGitStatusAutoRefresh } from '@/hooks/internal/useGitStatusAutoRefresh';

export interface FileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number | null;
  deletions: number | null;
  isStaged: boolean;
  diff?: string;
}

interface UseFileChangesOptions {
  isActive?: boolean;
  idleIntervalMs?: number;
  taskId?: string;
}

export function shouldRefreshFileChanges(
  taskPath: string | undefined,
  isActive: boolean,
  isDocumentVisible: boolean
): boolean {
  return Boolean(taskPath) && isActive && isDocumentVisible;
}

export function useFileChanges(taskPath?: string, options: UseFileChangesOptions = {}) {
  const [fileChanges, setFileChanges] = useState<FileChange[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDocumentVisible, setIsDocumentVisible] = useState(() => {
    if (typeof document === 'undefined') return true;
    return document.visibilityState === 'visible';
  });

  const { isActive = true, idleIntervalMs = 60000, taskId } = options;
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
    setFileChanges([]); // Clear stale state immediately
    if (taskPath) {
      setIsLoading(true);
    }
    taskPathRef.current = taskPath;
    hasLoadedRef.current = false;
  }, [taskPath]);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    const handleVisibility = () => {
      setIsDocumentVisible(document.visibilityState === 'visible');
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
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
        const result = await getCachedGitStatus(requestPath, { force: options?.force, taskId });

        if (!mountedRef.current) return;

        if (requestPath !== taskPathRef.current) {
          queueRefresh(true);
          return;
        }

        if (result?.success && result.changes && result.changes.length > 0) {
          const visibleChanges = filterVisibleGitStatusChanges(result.changes);
          const changes: FileChange[] = visibleChanges.map((change) => ({
            path: change.path,
            status: change.status as 'added' | 'modified' | 'deleted' | 'renamed',
            additions: change.additions ?? null,
            deletions: change.deletions ?? null,
            isStaged: change.isStaged || false,
            diff: change.diff,
          }));
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

  const shouldPoll = shouldRefreshFileChanges(taskPath, isActive, isDocumentVisible);
  const { shouldPollRef, scheduleWatcherRefresh, clearScheduledRefresh } = useGitStatusAutoRefresh({
    taskPath,
    taskId,
    shouldPoll,
    idleIntervalMs,
    hasLoadedRef,
    fetchChanges: fetchFileChanges,
  });

  useEffect(() => {
    if (!taskPath) return undefined;

    const unsubscribe = subscribeToFileChanges((event) => {
      if (event.detail.taskPath === taskPath && shouldPollRef.current) {
        scheduleWatcherRefresh({ force: true });
      }
    });

    return () => {
      unsubscribe();
    };
  }, [taskPath, shouldPollRef, scheduleWatcherRefresh]);

  const refreshChanges = async () => {
    clearScheduledRefresh();
    await fetchFileChanges(true, { force: true });
  };

  return {
    fileChanges,
    isLoading,
    error,
    refreshChanges,
  };
}
