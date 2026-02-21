import { useEffect, useState } from 'react';
import { getProvider } from '@shared/providers/registry';
import type { ProviderId } from '@shared/providers/registry';

interface AgentNameInfo {
  primaryName: string;
  additionalCount: number;
  displayLabel: string;
}

const FALLBACK: AgentNameInfo = { primaryName: '', additionalCount: 0, displayLabel: '' };

export function useTaskAgentNames(taskId: string, fallbackAgentId?: string): AgentNameInfo {
  const [info, setInfo] = useState<AgentNameInfo>(FALLBACK);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await window.electronAPI.getConversations(taskId);
        if (cancelled) return;

        const conversations =
          res?.success && Array.isArray(res.conversations) ? res.conversations : [];
        const providerIds = [
          ...new Set(
            conversations.map((c: { provider?: string }) => c.provider).filter(Boolean) as string[]
          ),
        ];

        if (providerIds.length === 0 && fallbackAgentId) {
          const provider = getProvider(fallbackAgentId as ProviderId);
          const name = provider?.name ?? fallbackAgentId;
          setInfo({ primaryName: name, additionalCount: 0, displayLabel: name });
          return;
        }

        if (providerIds.length === 0) {
          setInfo(FALLBACK);
          return;
        }

        const primaryProvider = getProvider(providerIds[0] as ProviderId);
        const primaryName = primaryProvider?.name ?? providerIds[0];
        const additionalCount = providerIds.length - 1;
        const displayLabel =
          additionalCount > 0 ? `${primaryName} +${additionalCount}` : primaryName;

        setInfo({ primaryName, additionalCount, displayLabel });
      } catch {
        if (!cancelled && fallbackAgentId) {
          const provider = getProvider(fallbackAgentId as ProviderId);
          const name = provider?.name ?? fallbackAgentId;
          setInfo({ primaryName: name, additionalCount: 0, displayLabel: name });
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
