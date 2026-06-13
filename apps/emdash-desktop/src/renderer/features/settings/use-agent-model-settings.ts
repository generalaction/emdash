import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import type { AgentModelSelection } from '@shared/core/agents/agent-models';
import type { AgentProviderId } from '@shared/core/agents/agent-provider-registry';
import type { AgentModels } from '@shared/core/app-settings';

/**
 * Reads and writes the per-provider default model + reasoning-effort selection
 * (the `agentModels` app setting). Updates merge into the existing provider
 * entry so changing the model preserves the reasoning effort and vice versa.
 */
export function useAgentModelSettings() {
  const { value, isLoading, isSaving, update } = useAppSettingsKey('agentModels');
  const selections: AgentModels = value ?? {};

  const setSelection = (providerId: AgentProviderId, patch: AgentModelSelection): void => {
    const current = selections[providerId] ?? {};
    const next: AgentModelSelection = { ...current, ...patch };
    update({ [providerId]: next } as Partial<AgentModels>);
  };

  return {
    selections,
    loading: isLoading,
    saving: isSaving,
    getSelection: (providerId: AgentProviderId): AgentModelSelection =>
      selections[providerId] ?? {},
    setSelection,
    setModel: (providerId: AgentProviderId, model: string | undefined): void =>
      setSelection(providerId, { model }),
    setReasoningEffort: (providerId: AgentProviderId, reasoningEffort: string | undefined): void =>
      setSelection(providerId, { reasoningEffort }),
  };
}
