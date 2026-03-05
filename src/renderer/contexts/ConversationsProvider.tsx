import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../hooks/use-toast';
import { rpc } from '../lib/rpc';
import { activityStore } from '../lib/activityStore';
import { terminalSessionRegistry } from '../terminal/SessionRegistry';
import { makePtyId } from '@shared/ptyId';
import { useLocalStorage } from '../hooks/useLocalStorage';
import type { Agent } from '../types';
import type { Conversation } from '../../main/services/DatabaseService';

export const conversationsQueryKey = (taskId: string) => ['conversations', taskId] as const;

function dispatchConversationsChanged(taskId: string): void {
  try {
    window.dispatchEvent(new CustomEvent('emdash:conversations-changed', { detail: { taskId } }));
  } catch {}
}

type ConversationsContextValue = {
  conversations: Conversation[];
  sortedConversations: Conversation[];
  activeConversationId: string | null;
  activeConversation: Conversation | null;
  mainConversationId: string | null;
  isLoaded: boolean;
  busyByConversationId: Record<string, boolean>;
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

  // Per-conversation busy state
  const [busyByConversationId, setBusyByConversationId] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    const unsubs: Array<() => void> = [];

    setBusyByConversationId((prev) => {
      const next: Record<string, boolean> = {};
      for (const c of conversations) next[c.id] = prev[c.id] ?? false;
      return next;
    });

    if (mainConversationId) {
      unsubs.push(
        activityStore.subscribe(taskId, (busy) => {
          if (cancelled) return;
          setBusyByConversationId((prev) => {
            if (prev[mainConversationId] === busy) return prev;
            return { ...prev, [mainConversationId]: busy };
          });
        })
      );
    }

    for (const conv of conversations) {
      if (conv.isMain) continue;
      const convId = conv.id;
      unsubs.push(
        activityStore.subscribe(
          convId,
          (busy) => {
            if (cancelled) return;
            setBusyByConversationId((prev) => {
              if (prev[convId] === busy) return prev;
              return { ...prev, [convId]: busy };
            });
          },
          { kinds: ['chat'] }
        )
      );
    }

    return () => {
      cancelled = true;
      for (const off of unsubs) {
        try {
          off();
        } catch {}
      }
    };
  }, [taskId, conversations, mainConversationId]);

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
      dispatchConversationsChanged(taskId);
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

      // Dispose the terminal for the closed chat
      const convToDelete = conversations.find((c) => c.id === conversationId);
      const convAgent = (convToDelete?.provider || 'claude') as Agent;
      terminalSessionRegistry.dispose(makePtyId(convAgent, 'chat', conversationId));

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
      dispatchConversationsChanged(taskId);
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

  return (
    <ConversationsContext.Provider
      value={{
        conversations,
        sortedConversations,
        activeConversationId,
        activeConversation,
        mainConversationId,
        isLoaded: isSuccess,
        busyByConversationId,
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
