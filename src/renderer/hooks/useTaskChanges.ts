import { useState, useEffect, useCallback } from 'react';

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

export function useTaskChanges(taskPath: string, taskId: string) {
  const [changes, setChanges] = useState<TaskChanges>({
    taskId,
    changes: [],
    totalAdditions: 0,
    totalDeletions: 0,
    isLoading: true,
  });

  const fetchChanges = useCallback(
    async (isInitialLoad = false) => {
      try {
        if (isInitialLoad) {
          setChanges((prev) => ({ ...prev, isLoading: true, error: undefined }));
        }

        const result = await window.electronAPI.getGitStatus(taskPath);

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
        setChanges({
          taskId,
          changes: [],
          totalAdditions: 0,
          totalDeletions: 0,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    },
    [taskPath, taskId]
  );

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    void fetchChanges(true);

    // Poll for changes every 20 seconds without loading state
    const interval = setInterval(() => {
      void fetchChanges(false);
    }, 20000);
    return () => clearInterval(interval);
  }, [fetchChanges]);

  return {
    ...changes,
  };
}
