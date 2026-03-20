import { useCallback, useEffect, useMemo } from 'react';
import type { CreateConversationParams } from '@shared/conversations';
import { makePtySessionId } from '@shared/ptySessionId';
import { useConversationsContext } from '@renderer/core/conversations/conversation-data-provider';
import { rpc } from '@renderer/core/ipc';
import { getPaneContainer } from '@renderer/core/pty/pane-sizing-context';
import { measureDimensions } from '@renderer/core/pty/pty-dimensions';
import { usePtySession } from '@renderer/core/pty/pty-session-context';

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

  const { registerSession, unregisterSession } = usePtySession();

  const conversations = useMemo(
    () => conversationsByTaskId[taskId] ?? [],
    [conversationsByTaskId, taskId]
  );

  const createConversation = useCallback(
    async (params: Omit<CreateConversationParams, 'projectId' | 'taskId'>) => {
      const sessionId = makePtySessionId(projectId, taskId, params.id);
      // Register frontend listener BEFORE the RPC to avoid losing PTY output.
      registerSession(sessionId);
      const conversation = await generalCreateConversation({
        projectId,
        taskId,
        initialSize: getConversationsPaneSize(),
        ...params,
      });
      return conversation;
    },
    [generalCreateConversation, projectId, registerSession, taskId]
  );

  const removeConversation = useCallback(
    (conversationId: string) => {
      unregisterSession(makePtySessionId(projectId, taskId, conversationId));
      deleteConversation({ projectId, taskId, conversationId });
    },
    [deleteConversation, projectId, taskId, unregisterSession]
  );

  // Start sessions for all existing conversations whenever the list changes.
  // registerSession() is idempotent — its boolean return value gates the RPC
  // so startSession is only called once per conversation.
  useEffect(() => {
    if (conversations.length === 0) return;
    const initialSize = getConversationsPaneSize();
    for (const conv of conversations) {
      const sessionId = makePtySessionId(projectId, taskId, conv.id);
      const isNew = registerSession(sessionId);
      if (isNew) {
        rpc.conversations.startSession(conv, initialSize).catch(() => {});
      }
    }
  }, [conversations, projectId, registerSession, taskId]);

  return { conversations, createConversation, removeConversation };
}
