import type { AgentProviderId } from '@emdash/plugins/agents';
import { useCallback, useEffect, useState } from 'react';
import { useLocalStorage } from '@renderer/lib/hooks/useLocalStorage';

const AUTO_APPROVE_STORAGE_KEY = 'initial-conversation:auto-approve-enabled';
const MODEL_STORAGE_KEY_PREFIX = 'initial-conversation:model:';

function modelStorageKey(providerId: AgentProviderId): string {
  return `${MODEL_STORAGE_KEY_PREFIX}${providerId}`;
}

function readStoredModel(providerId: AgentProviderId | null): string | null {
  if (!providerId) return null;
  try {
    const stored = JSON.parse(localStorage.getItem(modelStorageKey(providerId)) ?? 'null');
    return typeof stored === 'string' ? stored : null;
  } catch {
    return null;
  }
}

function useStoredModel(providerId: AgentProviderId | null) {
  const [state, setState] = useState(() => ({
    providerId,
    model: readStoredModel(providerId),
  }));
  const model = state.providerId === providerId ? state.model : readStoredModel(providerId);

  useEffect(() => {
    setState({ providerId, model: readStoredModel(providerId) });
    if (!providerId) return;
    const key = modelStorageKey(providerId);
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) {
        setState({ providerId, model: readStoredModel(providerId) });
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [providerId]);

  const setModel = useCallback(
    (nextModel: string | null) => {
      if (!providerId) return;
      try {
        const key = modelStorageKey(providerId);
        if (nextModel) {
          localStorage.setItem(key, JSON.stringify(nextModel));
        } else {
          localStorage.removeItem(key);
        }
      } catch {
        // Keep the in-memory preference when storage is unavailable.
      }
      setState({ providerId, model: nextModel });
    },
    [providerId]
  );

  return { model, setModel };
}

export function useConversationPreferences(
  providerId: AgentProviderId | null,
  autoApproveByDefault: boolean,
  modelOptions: Readonly<Record<string, unknown>> | null
) {
  const [autoApprovePreference, setAutoApprove] = useLocalStorage<boolean | null>(
    AUTO_APPROVE_STORAGE_KEY,
    null
  );
  const { model: storedModel, setModel } = useStoredModel(providerId);
  const model = storedModel && modelOptions && storedModel in modelOptions ? storedModel : null;

  return {
    autoApprove: autoApprovePreference ?? autoApproveByDefault,
    setAutoApprove,
    model,
    setModel,
  };
}
