import { useCallback, useEffect, useState } from 'react';
import type { KnowledgeDocument } from '@/types/electron-api';

export function useKnowledgeDocs(collectionId: string | undefined) {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<KnowledgeDocument | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDocuments = useCallback(async () => {
    if (!collectionId) {
      setDocuments([]);
      setSelectedDocument(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await window.electronAPI.contentKnowledgeGetByCollection(collectionId);
      if (result.success && result.data) {
        setDocuments(result.data);
      } else {
        setError(result.error || 'Failed to load documents');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  }, [collectionId]);

  useEffect(() => {
    loadDocuments();
  }, [collectionId]);

  const createDocument = useCallback(
    async (name: string, content: string, metadata?: Record<string, unknown>) => {
      if (!collectionId) return null;

      try {
        const result = await window.electronAPI.contentKnowledgeCreate({
          collectionId,
          name,
          content,
          metadata,
        });

        if (result.success && result.data) {
          setDocuments((prev) => [...prev, result.data!]);
          return result.data;
        } else {
          setError(result.error || 'Failed to create document');
          return null;
        }
      } catch (err) {
        setError(String(err));
        return null;
      }
    },
    [collectionId]
  );

  const uploadDocuments = useCallback(
    async (
      files: Array<{
        name: string;
        content: string;
        metadata?: Record<string, unknown>;
      }>
    ) => {
      if (!collectionId) return null;

      try {
        const result = await window.electronAPI.contentKnowledgeUpload({
          collectionId,
          documents: files,
        });

        if (result.success && result.data) {
          setDocuments((prev) => [...prev, ...result.data!]);
          return result.data;
        } else {
          setError(result.error || 'Failed to upload documents');
          return null;
        }
      } catch (err) {
        setError(String(err));
        return null;
      }
    },
    [collectionId]
  );

  const updateDocument = useCallback(
    async (
      id: string,
      updates: Partial<{
        name: string;
        content: string;
        metadata: Record<string, unknown>;
      }>
    ) => {
      try {
        const result = await window.electronAPI.contentKnowledgeUpdate({
          id,
          ...updates,
        });

        if (result.success && result.data) {
          setDocuments((prev) => prev.map((d) => (d.id === id ? result.data! : d)));
          if (selectedDocument?.id === id) {
            setSelectedDocument(result.data);
          }
          return result.data;
        } else {
          setError(result.error || 'Failed to update document');
          return null;
        }
      } catch (err) {
        setError(String(err));
        return null;
      }
    },
    [selectedDocument]
  );

  const deleteDocument = useCallback(
    async (id: string) => {
      try {
        const result = await window.electronAPI.contentKnowledgeDelete(id);
        if (result.success) {
          setDocuments((prev) => prev.filter((d) => d.id !== id));
          if (selectedDocument?.id === id) {
            setSelectedDocument(null);
          }
          return true;
        } else {
          setError(result.error || 'Failed to delete document');
          return false;
        }
      } catch (err) {
        setError(String(err));
        return false;
      }
    },
    [selectedDocument]
  );

  const selectDocument = useCallback((document: KnowledgeDocument | null) => {
    setSelectedDocument(document);
  }, []);

  const getContextForAgent = useCallback(async () => {
    if (!collectionId) return '';

    try {
      const result = await window.electronAPI.contentKnowledgeGetContextForAgent(collectionId);
      if (result.success && result.data) {
        return result.data;
      }
      return '';
    } catch {
      return '';
    }
  }, [collectionId]);

  return {
    documents,
    selectedDocument,
    isLoading,
    error,
    createDocument,
    uploadDocuments,
    updateDocument,
    deleteDocument,
    selectDocument,
    getContextForAgent,
    refresh: loadDocuments,
  };
}
