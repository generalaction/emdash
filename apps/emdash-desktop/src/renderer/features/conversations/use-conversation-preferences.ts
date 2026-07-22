import type { AgentProviderId } from '@emdash/plugins/agents';
import { useCallback } from 'react';
import { useLocalStorage } from '@renderer/lib/hooks/useLocalStorage';

const AUTO_APPROVE_STORAGE_KEY = 'initial-conversation:auto-approve-enabled';
const MODEL_STORAGE_KEY = 'initial-conversation:model-by-provider';

export function useConversationPreferences(
  providerId: AgentProviderId | null,
  autoApproveByDefault: boolean
) {
  const [autoApprove, setAutoApprove] = useLocalStorage(
    AUTO_APPROVE_STORAGE_KEY,
    autoApproveByDefault
  );
  const [modelsByProvider, setModelsByProvider] = useLocalStorage<
    Partial<Record<AgentProviderId, string>>
  >(MODEL_STORAGE_KEY, {});

  const model = providerId ? (modelsByProvider[providerId] ?? null) : null;
  const setModel = useCallback(
    (nextModel: string | null) => {
      if (!providerId) return;
      setModelsByProvider((current) => {
        const next = { ...current };
        if (nextModel) {
          next[providerId] = nextModel;
        } else {
          delete next[providerId];
        }
        return next;
      });
    },
    [providerId, setModelsByProvider]
  );

  return { autoApprove, setAutoApprove, model, setModel };
}
