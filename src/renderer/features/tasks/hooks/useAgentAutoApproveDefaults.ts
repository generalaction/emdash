import { getAgentAutoApproveDefault } from '@shared/agent-auto-approve-defaults';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';

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
