import { useCallback, useEffect, useMemo, useState } from 'react';
import { activityStore } from '../lib/activityStore';
import { rpc } from '../lib/rpc';

const CONVERSATIONS_CHANGED_EVENT = 'emdash:conversations-changed';

export function useTaskBusy(taskId: string) {
  const [mainBusy, setMainBusy] = useState(false);
  const [chatBusyById, setChatBusyById] = useState<Record<string, boolean>>({});
  const chatBusy = useMemo(() => Object.values(chatBusyById).some(Boolean), [chatBusyById]);

  const reloadChats = useCallback(async () => {
    try {
      const conversations = await rpc.db.getConversations(taskId);
      return conversations
        .filter((c: any) => c && !Boolean(c.isMain))
        .map((c: any) => String(c.id));
    } catch {
      return [];
    }
  }, [taskId]);

  useEffect(() => activityStore.subscribe(taskId, setMainBusy, { kinds: ['main'] }), [taskId]);

  useEffect(() => {
    let cancelled = false;
    const chatUnsubsById = new Map<string, () => void>();
    let loadSeq = 0;

    const syncChatIds = (chatIds: string[]) => {
      if (cancelled) return;
      const nextIds = new Set(chatIds);

      for (const [id, off] of Array.from(chatUnsubsById.entries())) {
        if (nextIds.has(id)) continue;
        try {
          off?.();
        } catch {}
        chatUnsubsById.delete(id);
      }

      for (const id of nextIds) {
        if (chatUnsubsById.has(id)) continue;
        const off = activityStore.subscribe(
          id,
          (busy) => {
            if (cancelled) return;
            setChatBusyById((prev) => {
              if (prev[id] === busy) return prev;
              return { ...prev, [id]: busy };
            });
          },
          { kinds: ['chat'] }
        );
        chatUnsubsById.set(id, off);
      }

      setChatBusyById((prev) => {
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
      try {
        for (const off of chatUnsubsById.values()) off?.();
      } catch {}
    };
  }, [taskId, reloadChats]);

  return mainBusy || chatBusy;
}
