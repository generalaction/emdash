import { useCallback, useEffect, useState } from 'react';
import { activityStore } from '../../lib/_deprecated/activityStore';
import { rpc } from '../../lib/rpc';

const CONVERSATIONS_CHANGED_EVENT = 'emdash:conversations-changed';

export function useTaskBusy(taskId: string) {
  const [busy, setBusy] = useState(false);

  const loadConversationIds = useCallback(async () => {
    try {
      const conversations = await rpc.db.getConversations(taskId);
      return conversations.map((c: any) => String(c.id));
    } catch {
      return [];
    }
  }, [taskId]);

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | null = null;

    const init = async () => {
      const conversationIds = await loadConversationIds();
      if (cancelled) return;
      unsub = activityStore.subscribe(
        taskId,
        ({ busy: isBusy }) => {
          if (!cancelled) setBusy(isBusy);
        },
        conversationIds
      );
    };

    void init();

    const onChanged = (event: Event) => {
      const custom = event as CustomEvent<{ taskId?: string }>;
      if (custom.detail?.taskId !== taskId) return;
      // Re-subscribe with updated conversation IDs
      unsub?.();
      unsub = null;
      void (async () => {
        const conversationIds = await loadConversationIds();
        if (cancelled) return;
        unsub = activityStore.subscribe(
          taskId,
          ({ busy: isBusy }) => {
            if (!cancelled) setBusy(isBusy);
          },
          conversationIds
        );
      })();
    };
    window.addEventListener(CONVERSATIONS_CHANGED_EVENT, onChanged);

    return () => {
      cancelled = true;
      window.removeEventListener(CONVERSATIONS_CHANGED_EVENT, onChanged);
      unsub?.();
    };
  }, [taskId, loadConversationIds]);

  return busy;
}
