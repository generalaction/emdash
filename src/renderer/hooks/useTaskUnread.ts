import { useCallback, useEffect, useMemo, useState } from 'react';
import { agentStatusStore } from '../lib/agentStatusStore';
import { rpc } from '../lib/rpc';

const CONVERSATIONS_CHANGED_EVENT = 'emdash:conversations-changed';

export function useTaskUnread(taskId: string): boolean {
  const [mainUnread, setMainUnread] = useState(false);
  const [chatUnreadById, setChatUnreadById] = useState<Record<string, boolean>>({});

  const reloadChats = useCallback(async () => {
    try {
      const conversations = await rpc.db.getConversations(taskId);
      return conversations
        .filter((conversation: any) => conversation && !Boolean(conversation.isMain))
        .map((conversation: any) => String(conversation.id));
    } catch {
      return [];
    }
  }, [taskId]);

  useEffect(() => agentStatusStore.subscribeUnread(taskId, setMainUnread), [taskId]);

  useEffect(() => {
    let cancelled = false;
    const chatUnsubs = new Map<string, () => void>();
    let loadSeq = 0;

    const syncChatIds = (chatIds: string[]) => {
      if (cancelled) return;
      const nextIds = new Set(chatIds);

      for (const [id, off] of Array.from(chatUnsubs.entries())) {
        if (nextIds.has(id)) continue;
        off?.();
        chatUnsubs.delete(id);
      }

      for (const id of nextIds) {
        if (chatUnsubs.has(id)) continue;
        chatUnsubs.set(
          id,
          agentStatusStore.subscribeUnread(id, (unread) => {
            if (cancelled) return;
            setChatUnreadById((prev) => {
              if (prev[id] === unread) return prev;
              return { ...prev, [id]: unread };
            });
          })
        );
      }

      setChatUnreadById((prev) => {
        const next: Record<string, boolean> = {};
        for (const id of nextIds) next[id] = prev[id] ?? false;
        return next;
      });
    };

    const load = async () => {
      const seq = ++loadSeq;
      const chatIds = await reloadChats();
      if (cancelled || seq !== loadSeq) return;
      syncChatIds(chatIds);
    };

    void load();

    const onChanged = (event: Event) => {
      const custom = event as CustomEvent<{ taskId?: string }>;
      if (custom.detail?.taskId !== taskId) return;
      void load();
    };
    window.addEventListener(CONVERSATIONS_CHANGED_EVENT, onChanged);

    return () => {
      cancelled = true;
      window.removeEventListener(CONVERSATIONS_CHANGED_EVENT, onChanged);
      for (const off of chatUnsubs.values()) off?.();
    };
  }, [taskId, reloadChats]);

  return useMemo(
    () => mainUnread || Object.values(chatUnreadById).some(Boolean),
    [chatUnreadById, mainUnread]
  );
}
