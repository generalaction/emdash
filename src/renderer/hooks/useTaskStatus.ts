import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AgentStatusKind } from '@shared/agentStatus';
import { PROVIDER_IDS } from '@shared/providers/registry';
import { makePtyId } from '@shared/ptyId';
import { agentStatusStore } from '../lib/agentStatusStore';
import { deriveTaskStatus } from '../lib/deriveTaskStatus';
import { rpc } from '../lib/rpc';

const EMPTY_STATUS = 'unknown' as AgentStatusKind;
const CONVERSATIONS_CHANGED_EVENT = 'emdash:conversations-changed';

export function useTaskStatus(taskId: string): AgentStatusKind {
  const [mainStatus, setMainStatus] = useState<AgentStatusKind>(EMPTY_STATUS);
  const [chatStatuses, setChatStatuses] = useState<Record<string, AgentStatusKind>>({});

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

  useEffect(
    () => agentStatusStore.subscribe(taskId, (snapshot) => setMainStatus(snapshot.kind)),
    [taskId]
  );

  useEffect(() => {
    let cancelled = false;
    const chatUnsubs = new Map<string, () => void>();
    const exitUnsubs = new Map<string, () => void>();
    let loadSeq = 0;

    const syncChatIds = (chatIds: string[]) => {
      if (cancelled) return;
      const nextIds = new Set(chatIds);

      for (const [id, off] of Array.from(chatUnsubs.entries())) {
        if (nextIds.has(id)) continue;
        try {
          off?.();
          exitUnsubs.get(id)?.();
        } catch {}
        chatUnsubs.delete(id);
        exitUnsubs.delete(id);
      }

      for (const id of nextIds) {
        if (chatUnsubs.has(id)) continue;

        chatUnsubs.set(
          id,
          agentStatusStore.subscribe(id, (snapshot) => {
            if (cancelled) return;
            setChatStatuses((prev) => {
              if (prev[id] === snapshot.kind) return prev;
              return { ...prev, [id]: snapshot.kind };
            });
          })
        );

        const offExits = PROVIDER_IDS.map((providerId) => {
          const ptyId = makePtyId(providerId, 'chat', id);
          return window.electronAPI.onPtyExit(ptyId, () => {
            agentStatusStore.handlePtyExit({ ptyId });
          });
        });
        exitUnsubs.set(id, () => {
          for (const off of offExits) off?.();
        });
      }

      setChatStatuses((prev) => {
        const next: Record<string, AgentStatusKind> = {};
        for (const id of nextIds) {
          next[id] = prev[id] ?? EMPTY_STATUS;
        }
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

    const mainExitUnsubs = PROVIDER_IDS.map((providerId) => {
      const ptyId = makePtyId(providerId, 'main', taskId);
      return window.electronAPI.onPtyExit(ptyId, () => {
        agentStatusStore.handlePtyExit({ ptyId });
      });
    });

    return () => {
      cancelled = true;
      window.removeEventListener(CONVERSATIONS_CHANGED_EVENT, onChanged);
      for (const off of chatUnsubs.values()) off?.();
      for (const off of exitUnsubs.values()) off?.();
      for (const off of mainExitUnsubs) off?.();
    };
  }, [taskId, reloadChats]);

  return useMemo(
    () => deriveTaskStatus([mainStatus, ...Object.values(chatStatuses)]),
    [chatStatuses, mainStatus]
  );
}
