import { useCallback, useEffect, useState } from 'react';
import type { ContentCollection } from '@/types/electron-api';

export function useCollections(workspaceId: string | undefined) {
  const [collections, setCollections] = useState<ContentCollection[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<ContentCollection | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCollections = useCallback(async () => {
    if (!workspaceId) {
      setCollections([]);
      setSelectedCollection(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await window.electronAPI.contentCollectionGetByWorkspace(workspaceId);
      if (result.success && result.data) {
        setCollections(result.data);
      } else {
        setError(result.error || 'Failed to load collections');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    loadCollections();
  }, [workspaceId]);

  const createCollection = useCallback(
    async (name: string, description?: string) => {
      if (!workspaceId) return null;

      try {
        const result = await window.electronAPI.contentCollectionCreate({
          workspaceId,
          name,
          description,
        });

        if (result.success && result.data) {
          const newCollection = { ...result.data, documentCount: 0 };
          setCollections((prev) => [...prev, newCollection]);
          return newCollection;
        } else {
          setError(result.error || 'Failed to create collection');
          return null;
        }
      } catch (err) {
        setError(String(err));
        return null;
      }
    },
    [workspaceId]
  );

  const updateCollection = useCallback(
    async (
      id: string,
      updates: Partial<{
        name: string;
        description: string;
      }>
    ) => {
      try {
        const result = await window.electronAPI.contentCollectionUpdate({
          id,
          ...updates,
        });

        if (result.success && result.data) {
          setCollections((prev) =>
            prev.map((c) => (c.id === id ? { ...result.data!, documentCount: c.documentCount } : c))
          );
          if (selectedCollection?.id === id) {
            setSelectedCollection({
              ...result.data,
              documentCount: selectedCollection.documentCount,
            });
          }
          return result.data;
        } else {
          setError(result.error || 'Failed to update collection');
          return null;
        }
      } catch (err) {
        setError(String(err));
        return null;
      }
    },
    [selectedCollection]
  );

  const deleteCollection = useCallback(
    async (id: string) => {
      try {
        const result = await window.electronAPI.contentCollectionDelete(id);
        if (result.success) {
          setCollections((prev) => prev.filter((c) => c.id !== id));
          if (selectedCollection?.id === id) {
            setSelectedCollection(null);
          }
          return true;
        } else {
          setError(result.error || 'Failed to delete collection');
          return false;
        }
      } catch (err) {
        setError(String(err));
        return false;
      }
    },
    [selectedCollection]
  );

  const selectCollection = useCallback((collection: ContentCollection | null) => {
    setSelectedCollection(collection);
  }, []);

  const incrementDocumentCount = useCallback((collectionId: string, delta: number = 1) => {
    setCollections((prev) =>
      prev.map((c) =>
        c.id === collectionId ? { ...c, documentCount: (c.documentCount || 0) + delta } : c
      )
    );
  }, []);

  return {
    collections,
    selectedCollection,
    isLoading,
    error,
    createCollection,
    updateCollection,
    deleteCollection,
    selectCollection,
    incrementDocumentCount,
    refresh: loadCollections,
  };
}
