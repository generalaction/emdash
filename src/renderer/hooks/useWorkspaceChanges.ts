import { useState, useEffect, useCallback } from 'react';

export interface WorkspaceChange {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  diff?: string;
}

export interface WorkspaceChanges {
  workspaceId: string;
  changes: WorkspaceChange[];
  totalAdditions: number;
  totalDeletions: number;
  isLoading: boolean;
  error?: string;
}

export function useWorkspaceChanges(workspacePath: string, workspaceId: string) {
  const [changes, setChanges] = useState<WorkspaceChanges>({
    workspaceId,
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

        const result = await window.electronAPI.getGitStatus(workspacePath);

        if (result.success && result.changes) {
          const filtered = result.changes.filter(
            (c: { path: string }) => !c.path.startsWith('.emdash/') && c.path !== 'PLANNING.md'
          );
          const totalAdditions = filtered.reduce((sum, change) => sum + (change.additions || 0), 0);
          const totalDeletions = filtered.reduce((sum, change) => sum + (change.deletions || 0), 0);

          setChanges({
            workspaceId,
            changes: filtered,
            totalAdditions,
            totalDeletions,
            isLoading: false,
          });
        } else {
          setChanges({
            workspaceId,
            changes: [],
            totalAdditions: 0,
            totalDeletions: 0,
            isLoading: false,
            error: result.error || 'Failed to fetch changes',
          });
        }
      } catch (error) {
        setChanges({
          workspaceId,
          changes: [],
          totalAdditions: 0,
          totalDeletions: 0,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    },
    [workspacePath, workspaceId]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchChanges(true);
    }, 0);

    // Poll for changes every 10 seconds without loading state
    const interval = setInterval(() => {
      void fetchChanges(false);
    }, 10000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [fetchChanges]);

  return {
    ...changes,
  };
}
