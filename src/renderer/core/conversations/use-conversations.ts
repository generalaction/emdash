import { useCallback, useEffect, useMemo } from 'react';
import type { CreateConversationParams } from '@shared/conversations';
import { makePtySessionId } from '@shared/ptySessionId';
import { useConversationsContext } from '@renderer/core/conversations/conversation-data-provider';
import { getPaneContainer } from '@renderer/core/pty/pane-sizing-context';
import { frontendPtyRegistry } from '@renderer/core/pty/pty';
import { measureDimensions } from '@renderer/core/pty/pty-dimensions';

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

  const conversations = useMemo(
    () => conversationsByTaskId[taskId] ?? [],
    [conversationsByTaskId, taskId]
  );

  const createConversation = useCallback(
    async (params: Omit<CreateConversationParams, 'projectId' | 'taskId'>) => {
      const sessionId = makePtySessionId(projectId, taskId, params.id);
      // The main process starts the PTY inside createConversation before returning;
      // register the frontend PTY concurrently so it is ready to receive output.
      void frontendPtyRegistry.register(sessionId);
      const conversation = await generalCreateConversation({
        projectId,
        taskId,
        initialSize: getConversationsPaneSize(),
        ...params,
      });
      return conversation;
    },
    [generalCreateConversation, projectId, taskId]
  );

  const removeConversation = useCallback(
    (conversationId: string) => {
      frontendPtyRegistry.unregister(makePtySessionId(projectId, taskId, conversationId));
      deleteConversation({ projectId, taskId, conversationId });
    },
    [deleteConversation, projectId, taskId]
  );

  // Connect a FrontendPty for each existing conversation. The main process
  // already started their PTY sessions during provisionTask; the renderer
  // just connects to receive output. Crashes respawn internally on the main
  // process reusing the same sessionId, so no re-registration is ever needed.
  useEffect(() => {
    if (conversations.length === 0) return;
    for (const conv of conversations) {
      void frontendPtyRegistry.register(makePtySessionId(projectId, taskId, conv.id));
    }
  }, [conversations, projectId, taskId]);

  return { conversations, createConversation, removeConversation };
}
