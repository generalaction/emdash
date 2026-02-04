import { useState, useEffect } from 'react';

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

  const fetchChanges = async (isInitialLoad = false) => {
    try {
      if (isInitialLoad) {
        setChanges(prev => ({ ...prev, isLoading: true, error: undefined }));
      }
      
      const result = await window.electronAPI.getGitStatus(workspacePath);
      
      if (result.success && result.changes) {
        const totalAdditions = result.changes.reduce((sum, change) => sum + change.additions, 0);
        const totalDeletions = result.changes.reduce((sum, change) => sum + change.deletions, 0);
        
        setChanges({
          workspaceId,
          changes: result.changes,
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
  };

  useEffect(() => {
    fetchChanges(true); 
    
    // Poll for changes every 15 seconds without loading state
    const interval = setInterval(() => fetchChanges(false), 15000);
    return () => clearInterval(interval);
  }, [workspacePath, workspaceId]);

  return {
    ...changes,
  };
}
