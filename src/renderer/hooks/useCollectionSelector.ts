import { useState, useEffect, useCallback } from 'react';
import type { ContentCollection, KnowledgeDocument } from '@/types/electron-api';

/**
 * Hook for collection selection in task creation flow.
 * Fetches collections for a workspace and provides CRUD operations.
 */
export function useCollectionSelector(workspaceId: string | null | undefined) {
  const [collections, setCollections] = useState<ContentCollection[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Fetch collections when workspace changes
  useEffect(() => {
    if (!workspaceId) {
      setCollections([]);
      setSelectedCollectionId(null);
      return;
    }

    let cancelled = false;

    const fetchCollections = async () => {
      setIsLoading(true);
      try {
        const result = await window.electronAPI.contentCollectionGetByWorkspace(workspaceId);
        if (!cancelled && result.success && result.data) {
          setCollections(result.data);
        }
      } catch (err) {
        console.error('Failed to fetch collections:', err);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchCollections();

    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  // Create a new collection
  const createCollection = useCallback(
    async (name: string, description?: string): Promise<ContentCollection | null> => {
      if (!workspaceId) return null;

      try {
        const result = await window.electronAPI.contentCollectionCreate({
          workspaceId,
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
    [workspaceId]
  );

  // Upload documents to a collection
  const uploadDocuments = useCallback(
    async (
      collectionId: string,
      files: Array<{ name: string; content: string }>
    ): Promise<KnowledgeDocument[] | null> => {
      try {
        const result = await window.electronAPI.contentKnowledgeUpload({
          collectionId,
          documents: files,
        });
        if (result.success && result.data) {
          // Update collection document count
          setCollections((prev) =>
            prev.map((c) =>
              c.id === collectionId
                ? { ...c, documentCount: (c.documentCount || 0) + result.data!.length }
                : c
            )
          );
          return result.data;
        }
      } catch (err) {
        console.error('Failed to upload documents:', err);
      }
      return null;
    },
    []
  );

  // Select a collection
  const selectCollection = useCallback((collectionId: string | null) => {
    setSelectedCollectionId(collectionId);
  }, []);

  // Get selected collection object
  const selectedCollection = collections.find((c) => c.id === selectedCollectionId) || null;

  return {
    collections,
    selectedCollectionId,
    selectedCollection,
    isLoading,
    selectCollection,
    createCollection,
    uploadDocuments,
  };
}
