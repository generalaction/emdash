import { useState, useEffect, useCallback } from 'react';
import type { Conversation } from '../types/chat';

interface UseConversationsResult {
  conversations: Conversation[];
  activeConversationId: string | null;
  activeConversation: Conversation | null;
  isLoading: boolean;
  createConversation: (title?: string) => Promise<Conversation | null>;
  selectConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
}

export function useConversations(workspaceId: string): UseConversationsResult {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load conversations for this workspace
  useEffect(() => {
    let cancelled = false;

    const loadConversations = async () => {
      try {
        setIsLoading(true);
        const result = await window.electronAPI.getConversations(workspaceId);

        if (cancelled) return;

        if (result.success && result.conversations && result.conversations.length > 0) {
          setConversations(result.conversations);

          // Try to restore last active from localStorage
          const lastActiveKey = `activeConversation:${workspaceId}`;
          const lastActive = localStorage.getItem(lastActiveKey);

          if (lastActive && result.conversations.some((c: Conversation) => c.id === lastActive)) {
            setActiveConversationId(lastActive);
          } else {
            // Select most recent
            setActiveConversationId(result.conversations[0].id);
          }
        } else {
          // No conversations exist, create a default one
          const defaultResult = await window.electronAPI.getOrCreateDefaultConversation(workspaceId);
          if (!cancelled && defaultResult.success && defaultResult.conversation) {
            setConversations([defaultResult.conversation]);
            setActiveConversationId(defaultResult.conversation.id);
          }
        }
      } catch (error) {
        console.error('Failed to load conversations:', error);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadConversations();

    return () => {
      cancelled = true;
    };
  }, [workspaceId]); // Only reload when workspace changes

  // Persist active conversation ID to localStorage
  useEffect(() => {
    if (activeConversationId) {
      const key = `activeConversation:${workspaceId}`;
      localStorage.setItem(key, activeConversationId);
    }
  }, [activeConversationId, workspaceId]);

  const createConversation = useCallback(
    async (title?: string): Promise<Conversation | null> => {
      // Calculate the next chat number (Chat 2, Chat 3, etc.)
      const chatNumbers = conversations
        .map(c => {
          const match = c.title.match(/^Chat (\d+)$/);
          return match ? parseInt(match[1], 10) : 0;
        })
        .filter(n => n > 0);

      const nextNumber = chatNumbers.length > 0 ? Math.max(...chatNumbers) + 1 : 2;
      const newTitle = title || `Chat ${nextNumber}`;
      const conversationId = `conv-${workspaceId}-${Date.now()}`;

      try {
        const result = await window.electronAPI.saveConversation({
          id: conversationId,
          workspaceId,
          title: newTitle,
        });

        if (result.success) {
          const newConversation: Conversation = {
            id: conversationId,
            workspaceId,
            title: newTitle,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };

          // Add new conversation to the right (end of array)
          setConversations(prev => [...prev, newConversation]);
          setActiveConversationId(conversationId);
          return newConversation;
        }
      } catch (error) {
        console.error('Failed to create conversation:', error);
      }

      return null;
    },
    [workspaceId, conversations]
  );

  const selectConversation = useCallback((id: string) => {
    setActiveConversationId(id);
  }, []);

  const renameConversation = useCallback(async (id: string, title: string) => {
    try {
      const result = await window.electronAPI.updateConversation(id, { title });

      if (result.success) {
        setConversations(prev =>
          prev.map(c => (c.id === id ? { ...c, title, updatedAt: new Date().toISOString() } : c))
        );
      }
    } catch (error) {
      console.error('Failed to rename conversation:', error);
    }
  }, []);

  const deleteConversation = useCallback(
    async (id: string) => {
      // Prevent deleting the last conversation
      if (conversations.length <= 1) {
        console.warn('Cannot delete the last conversation');
        return;
      }

      try {
        const result = await window.electronAPI.deleteConversation(id);

        if (result.success) {
          setConversations(prev => prev.filter(c => c.id !== id));

          // If we deleted the active conversation, switch to the most recent remaining one
          if (activeConversationId === id) {
            const remaining = conversations.filter(c => c.id !== id);
            if (remaining.length > 0) {
              setActiveConversationId(remaining[0].id);
            }
          }
        }
      } catch (error) {
        console.error('Failed to delete conversation:', error);
      }
    },
    [conversations, activeConversationId]
  );

  const activeConversation = conversations.find(c => c.id === activeConversationId) || null;

  return {
    conversations,
    activeConversationId,
    activeConversation,
    isLoading,
    createConversation,
    selectConversation,
    renameConversation,
    deleteConversation,
  };
}
