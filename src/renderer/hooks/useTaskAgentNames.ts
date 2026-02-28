import { useEffect, useState } from 'react';
import { getProvider } from '@shared/providers/registry';
import type { ProviderId } from '@shared/providers/registry';
import { rpc } from '../lib/rpc';

interface AgentNameInfo {
  primaryName: string;
  additionalCount: number;
  displayLabel: string;
  providerIds: string[];
}

const FALLBACK: AgentNameInfo = {
  primaryName: '',
  additionalCount: 0,
  displayLabel: '',
  providerIds: [],
};

export function useTaskAgentNames(taskId: string, fallbackAgentId?: string): AgentNameInfo {
  const [info, setInfo] = useState<AgentNameInfo>(FALLBACK);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const conversations = await rpc.db.getConversations(taskId);
        if (cancelled) return;
        const providerIds = [
          ...new Set(
            conversations.map((c) => c.provider ?? undefined).filter(Boolean) as string[]
          ),
        ];

        if (providerIds.length === 0 && fallbackAgentId) {
          const provider = getProvider(fallbackAgentId as ProviderId);
          const name = provider?.name ?? fallbackAgentId;
          setInfo({
            primaryName: name,
            additionalCount: 0,
            displayLabel: name,
            providerIds: [fallbackAgentId],
          });
          return;
        }

        if (providerIds.length === 0) {
          setInfo(FALLBACK);
          return;
        }

        const primaryProvider = getProvider(providerIds[0] as ProviderId);
        const primaryName = primaryProvider?.name ?? providerIds[0];
        const totalChats = conversations.filter((c) => c.provider).length;
        const additionalCount = Math.max(0, totalChats - 1);
        const displayLabel =
          additionalCount > 0 ? `${primaryName} +${additionalCount}` : primaryName;

        setInfo({ primaryName, additionalCount, displayLabel, providerIds });
      } catch {
        if (!cancelled && fallbackAgentId) {
          const provider = getProvider(fallbackAgentId as ProviderId);
          const name = provider?.name ?? fallbackAgentId;
          setInfo({
            primaryName: name,
            additionalCount: 0,
            displayLabel: name,
            providerIds: [fallbackAgentId],
          });
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [taskId, fallbackAgentId]);

  return info;
}
