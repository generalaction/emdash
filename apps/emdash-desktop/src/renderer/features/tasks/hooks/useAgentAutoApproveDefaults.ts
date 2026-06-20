import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import {
  buildGlobalAutoApproveDefaults,
  getAgentAutoApproveDefault,
  isGlobalAutoApproveEnabled,
} from '@shared/core/agents/agent-auto-approve-defaults';
import type { AgentProviderId } from '@shared/core/agents/agent-provider-registry';

export function useAgentAutoApproveDefaults() {
  const { value, isLoading, isSaving, isOverridden, update, reset } = useAppSettingsKey(
    'agentAutoApproveDefaults'
  );
  const defaults = value ?? {};

  return {
    defaults,
    loading: isLoading,
    saving: isSaving,
    isOverridden,
    globalAutoApproveEnabled: isGlobalAutoApproveEnabled(defaults),
    getDefault: (providerId: AgentProviderId) => getAgentAutoApproveDefault(defaults, providerId),
    setDefault: (providerId: AgentProviderId, enabled: boolean) =>
      update({ [providerId]: enabled }),
    setGlobalAutoApprove: (enabled: boolean) => {
      if (enabled) {
        update(buildGlobalAutoApproveDefaults(true));
        return;
      }
      reset();
    },
    resetGlobalAutoApprove: () => reset(),
  };
}
