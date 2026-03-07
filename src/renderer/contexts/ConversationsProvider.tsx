import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../hooks/use-toast';
import { rpc, events } from '../lib/rpc';
import { useLocalStorage } from '../hooks/useLocalStorage';
import type { Conversation } from '../../main/services/DatabaseService';
import { menuCloseTabChannel } from '@shared/events/appEvents';

export const conversationsQueryKey = (taskId: string) => ['conversations', taskId] as const;

type ConversationsContextValue = {
  conversations: Conversation[];
  sortedConversations: Conversation[];
  activeConversationId: string | null;
  activeConversation: Conversation | null;
  mainConversationId: string | null;
  isLoaded: boolean;
  createConversation: (title: string, agent: string) => Promise<Conversation | null>;
  switchConversation: (conversationId: string) => void;
  closeConversation: (conversationId: string) => Promise<void>;
};

const ConversationsContext = createContext<ConversationsContextValue | null>(null);

export function ConversationsProvider({
  taskId,
  initialAgent,
  children,
}: {
  taskId: string;
  initialAgent?: string | null;
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: conversations = [], isSuccess } = useQuery({
    queryKey: conversationsQueryKey(taskId),
    queryFn: async (): Promise<Conversation[]> => {
      const loaded = await rpc.db.getConversations(taskId);
      if (loaded.length > 0) return loaded;

      // No conversations yet — bootstrap the default for backward compat
      const defaultConv = await rpc.db.getOrCreateDefaultConversation(taskId);
      const bootstrapped: Conversation = {
        ...defaultConv,
        provider: initialAgent ?? defaultConv.provider ?? 'claude',
        isMain: true,
      };
      await rpc.db.saveConversation(bootstrapped);
      return [bootstrapped];
    },
    staleTime: Infinity,
    gcTime: 30_000,
  });

  // Active conversation ID — persisted to localStorage keyed by taskId
  const storageKey = `activeConversation:${taskId}`;
  const [activeConversationId, setActiveConversationId] = useLocalStorage<string | null>(
    storageKey,
    null
  );
  const initializedForTaskRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isSuccess || conversations.length === 0) return;
    if (initializedForTaskRef.current === taskId) return;
    initializedForTaskRef.current = taskId;

    // The hook's stored value may be stale when taskId changes without remounting,
    // so read the new key's value directly from localStorage.
    let storedId: string | null = null;
    try {
      const item = localStorage.getItem(storageKey);
      storedId = item !== null ? (JSON.parse(item) as string) : null;
    } catch {}

    const validStored = storedId && conversations.some((c) => c.id === storedId) ? storedId : null;
    const chosenId = validStored ?? conversations[0]?.id ?? null;
    setActiveConversationId(chosenId);
  }, [isSuccess, conversations, taskId, storageKey, setActiveConversationId]);

  const mainConversationId = useMemo(
    () => conversations.find((c) => c.isMain)?.id ?? null,
    [conversations]
  );

  const sortedConversations = useMemo(
    () =>
      [...conversations].sort((a, b) => {
        if (a.displayOrder !== undefined && b.displayOrder !== undefined) {
          return a.displayOrder - b.displayOrder;
        }
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }),
    [conversations]
  );

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) ?? null,
    [conversations, activeConversationId]
  );

  const { mutateAsync: createConversationMutation } = useMutation({
    mutationFn: ({ title, provider }: { title: string; provider: string }) =>
      rpc.db.createConversation({ taskId, title, provider, isMain: false }),
    onSuccess: (newConv) => {
      queryClient.setQueryData(conversationsQueryKey(taskId), (old: Conversation[] = []) => [
        ...old,
        newConv,
      ]);
      setActiveConversationId(newConv.id);
      void queryClient.invalidateQueries({ queryKey: conversationsQueryKey(taskId) });
    },
    onError: (error) => {
      console.error('Failed to create conversation:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create chat',
        variant: 'destructive',
      });
    },
  });

  const createConversation = useCallback(
    async (title: string, agent: string): Promise<Conversation | null> => {
      try {
        return await createConversationMutation({ title, provider: agent });
      } catch {
        return null;
      }
    },
    [createConversationMutation]
  );

  const switchConversation = useCallback(
    (conversationId: string): void => {
      setActiveConversationId(conversationId);
    },
    [setActiveConversationId]
  );

  const { mutateAsync: closeConversationMutation } = useMutation({
    mutationFn: (conversationId: string) => rpc.db.deleteConversation(conversationId),
    onMutate: (conversationId) => {
      const snapshot = queryClient.getQueryData<Conversation[]>(conversationsQueryKey(taskId));

      // Main process will kill the PTY and emit ptyKilledChannel, which TerminalSessionManager
      // subscribes to and calls dispose(). No speculative dispose needed here.

      // Update active conversation before removing from cache
      if (conversationId === activeConversationId) {
        const remaining = conversations.filter((c) => c.id !== conversationId);
        const newActiveId = remaining[0]?.id ?? null;
        if (newActiveId) setActiveConversationId(newActiveId);
      }

      queryClient.setQueryData(conversationsQueryKey(taskId), (old: Conversation[] = []) =>
        old.filter((c) => c.id !== conversationId)
      );

      return { snapshot };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: conversationsQueryKey(taskId) });
    },
    onError: (_error, _conversationId, context) => {
      if (context?.snapshot) {
        queryClient.setQueryData(conversationsQueryKey(taskId), context.snapshot);
      }
    },
  });

  const closeConversation = useCallback(
    async (conversationId: string): Promise<void> => {
      if (conversations.length <= 1) {
        toast({
          title: 'Cannot Close',
          description: 'Cannot close the last chat',
          variant: 'destructive',
        });
        return;
      }
      await closeConversationMutation(conversationId);
    },
    [conversations.length, closeConversationMutation, toast]
  );

  // Keyboard shortcut: Cmd+Shift+J/K cycles through conversation tabs
  useEffect(() => {
    const handleAgentSwitch = (event: Event) => {
      const customEvent = event as CustomEvent<{ direction: 'next' | 'prev' }>;
      if (conversations.length <= 1) return;
      const direction = customEvent.detail?.direction;
      if (!direction) return;

      const currentIndex = conversations.findIndex((c) => c.id === activeConversationId);
      if (currentIndex === -1) return;

      let newIndex: number;
      if (direction === 'prev') {
        newIndex = currentIndex <= 0 ? conversations.length - 1 : currentIndex - 1;
      } else {
        newIndex = (currentIndex + 1) % conversations.length;
      }

      const newConversation = conversations[newIndex];
      if (newConversation) {
        switchConversation(newConversation.id);
      }
    };

    window.addEventListener('emdash:switch-agent', handleAgentSwitch);
    return () => {
      window.removeEventListener('emdash:switch-agent', handleAgentSwitch);
    };
  }, [conversations, activeConversationId, switchConversation]);

  // Close active tab on Cmd+W (native menu or custom event)
  useEffect(() => {
    const closeActiveTab = () => {
      if (activeConversationId) {
        void closeConversation(activeConversationId);
      }
    };
    const cleanupIpc = events.on(menuCloseTabChannel, closeActiveTab);
    window.addEventListener('emdash:close-active-chat', closeActiveTab);
    return () => {
      cleanupIpc();
      window.removeEventListener('emdash:close-active-chat', closeActiveTab);
    };
  }, [activeConversationId, closeConversation]);

  return (
    <ConversationsContext.Provider
      value={{
        conversations,
        sortedConversations,
        activeConversationId,
        activeConversation,
        mainConversationId,
        isLoaded: isSuccess,
        createConversation,
        switchConversation,
        closeConversation,
      }}
    >
      {children}
    </ConversationsContext.Provider>
  );
}

export function useConversations(): ConversationsContextValue {
  const ctx = useContext(ConversationsContext);
  if (!ctx) throw new Error('useConversations must be used within ConversationsProvider');
  return ctx;
}
