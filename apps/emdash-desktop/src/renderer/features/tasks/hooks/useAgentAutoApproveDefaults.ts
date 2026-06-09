import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { getAgentAutoApproveDefault } from '@shared/core/agents/agent-auto-approve-defaults';
import type { AgentProviderId } from '@shared/core/agents/agent-provider-registry';

export function useAgentAutoApproveDefaults() {
  const { value, isLoading, isSaving, update } = useAppSettingsKey('agentAutoApproveDefaults');
  const defaults = value ?? {};

  return {
    defaults,
    loading: isLoading,
    saving: isSaving,
    getDefault: (providerId: AgentProviderId) => getAgentAutoApproveDefault(defaults, providerId),
    setDefault: (providerId: AgentProviderId, enabled: boolean) =>
      update({ [providerId]: enabled }),
  };
}
