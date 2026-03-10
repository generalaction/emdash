import { useCallback, useEffect, useState } from 'react';
import type { ContentWorkspace, ContentKanbanColumn } from '@/types/electron-api';

export function useContentWorkspace(projectId: string | undefined) {
  const [workspaces, setWorkspaces] = useState<ContentWorkspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<ContentWorkspace | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadWorkspaces = useCallback(async () => {
    if (!projectId) {
      setWorkspaces([]);
      setActiveWorkspace(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await window.electronAPI.contentWorkspaceGetByProject(projectId);
      if (result.success && result.data) {
        setWorkspaces(result.data);
        // Auto-select first workspace if none selected
        if (result.data.length > 0 && !activeWorkspace) {
          setActiveWorkspace(result.data[0]);
        }
      } else {
        setError(result.error || 'Failed to load workspaces');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  }, [projectId, activeWorkspace]);

  useEffect(() => {
    loadWorkspaces();
  }, [projectId]);

  const createWorkspace = useCallback(
    async (
      name: string,
      options?: {
        kanbanColumns?: ContentKanbanColumn[];
        defaultAgents?: string[];
      }
    ) => {
      if (!projectId) return null;

      try {
        const result = await window.electronAPI.contentWorkspaceCreate({
          projectId,
          name,
          kanbanColumns: options?.kanbanColumns,
          defaultAgents: options?.defaultAgents,
        });

        if (result.success && result.data) {
          setWorkspaces((prev) => [...prev, result.data!]);
          setActiveWorkspace(result.data);
          return result.data;
        } else {
          setError(result.error || 'Failed to create workspace');
          return null;
        }
      } catch (err) {
        setError(String(err));
        return null;
      }
    },
    [projectId]
  );

  const updateWorkspace = useCallback(
    async (
      id: string,
      updates: Partial<{
        name: string;
        kanbanColumns: ContentKanbanColumn[];
        defaultAgents: string[];
      }>
    ) => {
      try {
        const result = await window.electronAPI.contentWorkspaceUpdate({
          id,
          ...updates,
        });

        if (result.success && result.data) {
          setWorkspaces((prev) => prev.map((w) => (w.id === id ? result.data! : w)));
          if (activeWorkspace?.id === id) {
            setActiveWorkspace(result.data);
          }
          return result.data;
        } else {
          setError(result.error || 'Failed to update workspace');
          return null;
        }
      } catch (err) {
        setError(String(err));
        return null;
      }
    },
    [activeWorkspace]
  );

  const deleteWorkspace = useCallback(
    async (id: string) => {
      try {
        const result = await window.electronAPI.contentWorkspaceDelete(id);
        if (result.success) {
          setWorkspaces((prev) => prev.filter((w) => w.id !== id));
          if (activeWorkspace?.id === id) {
            setActiveWorkspace(null);
          }
          return true;
        } else {
          setError(result.error || 'Failed to delete workspace');
          return false;
        }
      } catch (err) {
        setError(String(err));
        return false;
      }
    },
    [activeWorkspace]
  );

  const selectWorkspace = useCallback((workspace: ContentWorkspace | null) => {
    setActiveWorkspace(workspace);
  }, []);

  return {
    workspaces,
    activeWorkspace,
    isLoading,
    error,
    createWorkspace,
    updateWorkspace,
    deleteWorkspace,
    selectWorkspace,
    refresh: loadWorkspaces,
  };
}
