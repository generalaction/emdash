import { useCallback, useEffect, useMemo } from 'react';
import { CreateConversationParams } from '@shared/conversations';
import { getPaneContainer } from '@renderer/core/pty/pane-sizing-context';
import { measureDimensions } from '@renderer/core/pty/pty-dimensions';
import { useConversationsContext } from '@renderer/features/conversations/conversation-data-provider';
import { useConversationSessions } from '@renderer/features/conversations/conversation-sessions-provider';

/** Measure the conversations pane using a typical monospace cell size (13px font). */
function getConversationsPaneSize() {
  const container = getPaneContainer('conversations');
  return container ? (measureDimensions(container, 8, 16) ?? undefined) : undefined;
}

export function useConversations({ taskId, projectId }: { projectId: string; taskId: string }) {
  const {
    conversationsByTaskId,
    deleteConversation,
    createConversation: generalCreateConversation,
  } = useConversationsContext();

  const { startSession } = useConversationSessions();

  const conversations = useMemo(
    () => conversationsByTaskId[taskId] ?? [],
    [conversationsByTaskId, taskId]
  );

  const removeConversation = useCallback(
    (conversationId: string) => {
      deleteConversation({ projectId, taskId, conversationId });
    },
    [deleteConversation, projectId, taskId]
  );

  const createConversation = useCallback(
    async (params: Omit<CreateConversationParams, 'projectId' | 'taskId'>) => {
      const conversation = await generalCreateConversation({ projectId, taskId, ...params });
      startSession(conversation, projectId, taskId, getConversationsPaneSize());
      return conversation;
    },
    [generalCreateConversation, projectId, taskId, startSession]
  );

  // Start sessions for all existing conversations whenever the list changes.
  // startSession is idempotent so re-running for already-started sessions is safe.
  useEffect(() => {
    if (conversations.length === 0) return;
    const initialSize = getConversationsPaneSize();
    for (const conv of conversations) {
      startSession(conv, projectId, taskId, initialSize);
    }
  }, [conversations, projectId, startSession, taskId]);

  return {
    removeConversation,
    createConversation,
    conversations,
  };
}
