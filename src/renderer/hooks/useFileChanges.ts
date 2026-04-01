import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeToFileChanges } from '@/lib/fileChangeEvents';
import {
  buildCacheKey,
  getCachedGitStatus,
  getCachedResult,
  onCacheRevalidated,
} from '@/lib/gitStatusCache';
import type { GitStatusChange } from '@/lib/gitStatusCache';
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

function toFileChange(change: GitStatusChange): FileChange {
  return {
    path: change.path,
    status: change.status as 'added' | 'modified' | 'deleted' | 'renamed',
    additions: change.additions ?? null,
    deletions: change.deletions ?? null,
    isStaged: change.isStaged || false,
    diff: change.diff,
  };
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
  const [isRevalidating, setIsRevalidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDocumentVisible, setIsDocumentVisible] = useState(() => {
    if (typeof document === 'undefined') return true;
    return document.visibilityState === 'visible';
  });

  const { isActive = true, idleIntervalMs = 60000, taskId } = options;
  const taskPathRef = useRef(taskPath);
  const taskIdRef = useRef(taskId);
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
    taskIdRef.current = taskId;
    hasLoadedRef.current = false;

    setIsRevalidating(false);

    if (!taskPath) {
      setFileChanges([]);
      return;
    }

    const cached = getCachedResult(taskPath, taskId);
    if (cached) {
      // Show cached data immediately (even if stale)
      if (cached.result?.success && cached.result.changes && cached.result.changes.length > 0) {
        setFileChanges(filterVisibleGitStatusChanges(cached.result.changes).map(toFileChange));
      } else {
        setFileChanges([]);
      }
      setIsRevalidating(cached.isStale);
    } else {
      setFileChanges([]);
      setIsLoading(true);
    }

    // Kick off a fetch immediately so same-path/taskId changes don't wait
    // for the idle poll or a watcher event to trigger a load.
    void fetchFileChanges(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchFileChanges is stable (deps: [queueRefresh]) and reads taskPath/taskId from refs
  }, [taskPath, taskId]);

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
      if (mountedRef.current && !getCachedResult(taskPathRef.current ?? '', taskIdRef.current)) {
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
      if (isInitialLoad && mountedRef.current && !getCachedResult(currentPath, taskIdRef.current)) {
        setIsLoading(true);
        setError(null);
      }

      const requestPath = currentPath;
      const requestTaskId = taskIdRef.current;

      const isStale = () =>
        requestPath !== taskPathRef.current || requestTaskId !== taskIdRef.current;

      try {
        const result = await getCachedGitStatus(requestPath, {
          force: options?.force,
          taskId: requestTaskId,
        });

        if (!mountedRef.current) return;

        if (isStale()) {
          queueRefresh(true);
          return;
        }

        if (result?.success) {
          setFileChanges(
            result.changes?.length
              ? filterVisibleGitStatusChanges(result.changes).map(toFileChange)
              : []
          );
          setError(null);
        } else if (hasLoadedRef.current) {
          setError(result?.error || 'Failed to refresh file changes');
        } else {
          setFileChanges([]);
          setError(result?.error || 'Failed to load file changes');
        }
      } catch (err) {
        if (!mountedRef.current) return;
        if (isStale()) {
          queueRefresh(true);
          return;
        }
        console.error('Failed to fetch file changes:', err);
        setError('Failed to load file changes');
        if (!hasLoadedRef.current) {
          setFileChanges([]);
        }
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
    const expectedKey = buildCacheKey(taskPath, taskId);

    const unsubRevalidate = onCacheRevalidated((key, result) => {
      if (!mountedRef.current || key !== expectedKey) return;

      setIsLoading(false);
      setIsRevalidating(false);

      if (result.success) {
        setError(null);
        setFileChanges(
          result.changes?.length
            ? filterVisibleGitStatusChanges(result.changes).map(toFileChange)
            : []
        );
        return;
      }

      // Preserve existing fileChanges on background refresh failure
      setError(result.error || 'Failed to refresh file changes');
    });

    return () => {
      unsubRevalidate();
    };
  }, [taskPath, taskId]);

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
    isRevalidating,
    error,
    refreshChanges,
  };
}
