import { useState, useCallback, useEffect } from 'react';
import type { ContentWorkspace, ContentCollection } from '@/types/electron-api';
import type { ContentBrief } from '@/components/content/ContentBriefFields';
import { createContentWorkflowMetadata } from '@/lib/contentWorkflowStatus';

export interface ContentTaskData {
  workspaceId: string | null;
  collectionId: string | null;
  brief: ContentBrief;
}

/**
 * Hook for managing content-specific task creation data.
 * Combines workspace selection, collection selection, and content brief.
 */
export function useContentTaskCreation(projectId: string | null | undefined) {
  // Workspaces
  const [workspaces, setWorkspaces] = useState<ContentWorkspace[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [isLoadingWorkspaces, setIsLoadingWorkspaces] = useState(false);

  // Collections (filtered by selected workspace)
  const [collections, setCollections] = useState<ContentCollection[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [isLoadingCollections, setIsLoadingCollections] = useState(false);

  // Content brief
  const [brief, setBrief] = useState<ContentBrief>({});

  // Fetch workspaces when project changes
  useEffect(() => {
    if (!projectId) {
      setWorkspaces([]);
      setSelectedWorkspaceId(null);
      return;
    }

    let cancelled = false;

    const fetchWorkspaces = async () => {
      setIsLoadingWorkspaces(true);
      try {
        const result = await window.electronAPI.contentWorkspaceGetByProject(projectId);
        if (!cancelled && result.success && result.data) {
          setWorkspaces(result.data);
          // Auto-select first workspace if available
          if (result.data.length > 0 && !selectedWorkspaceId) {
            setSelectedWorkspaceId(result.data[0].id);
          }
        }
      } catch (err) {
        console.error('Failed to fetch workspaces:', err);
      } finally {
        if (!cancelled) {
          setIsLoadingWorkspaces(false);
        }
      }
    };

    fetchWorkspaces();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Fetch collections when workspace changes
  useEffect(() => {
    if (!selectedWorkspaceId) {
      setCollections([]);
      setSelectedCollectionId(null);
      return;
    }

    let cancelled = false;

    const fetchCollections = async () => {
      setIsLoadingCollections(true);
      try {
        const result =
          await window.electronAPI.contentCollectionGetByWorkspace(selectedWorkspaceId);
        if (!cancelled && result.success && result.data) {
          setCollections(result.data);
        }
      } catch (err) {
        console.error('Failed to fetch collections:', err);
      } finally {
        if (!cancelled) {
          setIsLoadingCollections(false);
        }
      }
    };

    fetchCollections();

    return () => {
      cancelled = true;
    };
  }, [selectedWorkspaceId]);

  // Create workspace
  const createWorkspace = useCallback(
    async (name: string): Promise<ContentWorkspace | null> => {
      if (!projectId) return null;
      try {
        const result = await window.electronAPI.contentWorkspaceCreate({
          projectId,
          name,
        });
        if (result.success && result.data) {
          setWorkspaces((prev) => [...prev, result.data!]);
          return result.data;
        }
      } catch (err) {
        console.error('Failed to create workspace:', err);
      }
      return null;
    },
    [projectId]
  );

  // Create collection
  const createCollection = useCallback(
    async (name: string, description?: string): Promise<ContentCollection | null> => {
      if (!selectedWorkspaceId) return null;
      try {
        const result = await window.electronAPI.contentCollectionCreate({
          workspaceId: selectedWorkspaceId,
          name,
          description,
        });
        if (result.success && result.data) {
          setCollections((prev) => [...prev, result.data!]);
          return result.data;
        }
      } catch (err) {
        console.error('Failed to create collection:', err);
      }
      return null;
    },
    [selectedWorkspaceId]
  );

  // Upload documents to collection
  const uploadDocuments = useCallback(
    async (
      collectionId: string,
      files: Array<{ name: string; content: string }>
    ): Promise<boolean> => {
      try {
        const result = await window.electronAPI.contentKnowledgeUpload({
          collectionId,
          documents: files,
        });
        if (result.success) {
          // Update collection document count
          setCollections((prev) =>
            prev.map((c) =>
              c.id === collectionId
                ? { ...c, documentCount: (c.documentCount || 0) + (result.data?.length || 0) }
                : c
            )
          );
          return true;
        }
      } catch (err) {
        console.error('Failed to upload documents:', err);
      }
      return false;
    },
    []
  );

  // Get metadata object to attach to task
  const getTaskMetadata = useCallback((): Record<string, unknown> => {
    const metadata: Record<string, unknown> = {};

    if (selectedWorkspaceId || selectedCollectionId || Object.keys(brief).length > 0) {
      metadata.contentWorkflow = createContentWorkflowMetadata(
        'backlog', // Start in backlog
        selectedCollectionId || undefined,
        Object.keys(brief).length > 0 ? brief : undefined
      );
    }

    return metadata;
  }, [selectedWorkspaceId, selectedCollectionId, brief]);

  // Check if content mode is active
  const isContentMode = selectedWorkspaceId !== null;

  // Selected objects
  const selectedWorkspace = workspaces.find((w) => w.id === selectedWorkspaceId) || null;
  const selectedCollection = collections.find((c) => c.id === selectedCollectionId) || null;

  // Reset all content data
  const reset = useCallback(() => {
    setSelectedCollectionId(null);
    setBrief({});
  }, []);

  return {
    // Workspaces
    workspaces,
    selectedWorkspaceId,
    selectedWorkspace,
    isLoadingWorkspaces,
    setSelectedWorkspaceId,
    createWorkspace,

    // Collections
    collections,
    selectedCollectionId,
    selectedCollection,
    isLoadingCollections,
    setSelectedCollectionId,
    createCollection,
    uploadDocuments,

    // Brief
    brief,
    setBrief,

    // Utilities
    isContentMode,
    getTaskMetadata,
    reset,
  };
}
