import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo } from 'react';
import type {
  Conversation,
  CreateConversationParams,
  RenameConversationParams,
} from '@shared/conversations';
import { rpc } from '@renderer/core/ipc';

interface ConversationDataContextValue {
  conversations: Conversation[];
  conversationsByTaskId: Record<string, Conversation[]>;
  deleteConversation: (params: {
    projectId: string;
    taskId: string;
    conversationId: string;
  }) => void;
  createConversation: (params: CreateConversationParams) => Promise<Conversation>;
  renameConversation: (params: RenameConversationParams) => void;
}

const ConversationDataContext = createContext<ConversationDataContextValue | null>(null);

export function ConversationDataProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  const { data: conversations } = useQuery({
    queryKey: ['conversations'],
    queryFn: () => rpc.conversations.getConversations(),
  });

  const conversationsByTaskId = useMemo(() => {
    return (conversations ?? []).reduce(
      (acc, conversation) => {
        acc[conversation.taskId] = [...(acc[conversation.taskId] ?? []), conversation];
        return acc;
      },
      {} as Record<string, Conversation[]>
    );
  }, [conversations]);

  const deleteConversationMutation = useMutation({
    mutationFn: ({
      projectId,
      taskId,
      conversationId,
    }: {
      projectId: string;
      taskId: string;
      conversationId: string;
    }) => rpc.conversations.deleteConversation(projectId, taskId, conversationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  const createConversationMutation = useMutation({
    mutationFn: rpc.conversations.createConversation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  const renameConversationMutation = useMutation({
    mutationFn: ({ conversationId, newTitle }: RenameConversationParams) =>
      rpc.conversations.renameConversation(conversationId, newTitle),
    onMutate: async ({ conversationId, newTitle }) => {
      await queryClient.cancelQueries({ queryKey: ['conversations'] });
      const previous = queryClient.getQueryData<Conversation[]>(['conversations']);
      queryClient.setQueryData<Conversation[]>(['conversations'], (old) =>
        old?.map((c) => (c.id === conversationId ? { ...c, title: newTitle.trim() } : c))
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['conversations'], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  const deleteConversation = useCallback(
    ({
      projectId,
      taskId,
      conversationId,
    }: {
      projectId: string;
      taskId: string;
      conversationId: string;
    }) => {
      deleteConversationMutation.mutate({ projectId, taskId, conversationId });
    },
    [deleteConversationMutation]
  );

  const createConversation = useCallback(
    (params: CreateConversationParams): Promise<Conversation> => {
      return createConversationMutation.mutateAsync(params);
    },
    [createConversationMutation]
  );

  const renameConversation = useCallback(
    ({ conversationId, newTitle }: RenameConversationParams) => {
      renameConversationMutation.mutate({ conversationId, newTitle });
    },
    [renameConversationMutation]
  );

  return (
    <ConversationDataContext.Provider
      value={{
        conversations: conversations ?? [],
        conversationsByTaskId,
        deleteConversation,
        createConversation,
        renameConversation,
      }}
    >
      {children}
    </ConversationDataContext.Provider>
  );
}

export function useConversationsContext() {
  const context = useContext(ConversationDataContext);
  if (!context) {
    throw new Error('useConversationsContext must be used within a ConversationDataProvider');
  }
  return context;
}
