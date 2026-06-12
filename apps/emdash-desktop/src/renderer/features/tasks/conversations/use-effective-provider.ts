import { useMemo, useState } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useAgentInstallationStatuses } from '@renderer/lib/stores/use-agent-installation-statuses';
import {
  isValidProviderId,
  type AgentProviderId,
} from '@shared/core/agents/agent-provider-registry';
import { resolveConversationProviderSelection } from './provider-selection';

export type EffectiveProvider = {
  providerId: AgentProviderId | null;
  setProviderOverride: (id: AgentProviderId | null) => void;
  createDisabled: boolean;
};

export function useEffectiveProvider(
  connectionId?: string,
  initialOverride?: AgentProviderId
): EffectiveProvider {
  const [providerOverride, setProviderOverride] = useState<AgentProviderId | null>(
    initialOverride ?? null
  );

  const { value: defaultAgentValue } = useAppSettingsKey('defaultAgent');
  const defaultProviderId: AgentProviderId = isValidProviderId(defaultAgentValue)
    ? defaultAgentValue
    : 'claude';

  const { data: statuses } = useAgentInstallationStatuses(connectionId);
  const availabilityKnown = statuses !== undefined;

  const installedProviderIds = useMemo(
    () =>
      (statuses ?? []).filter((s) => s.status === 'available').map((s) => s.id as AgentProviderId),
    [statuses]
  );

  const { providerId, createDisabled } = resolveConversationProviderSelection({
    defaultProviderId,
    providerOverride,
    installedProviderIds,
    availabilityKnown,
  });

  return { providerId, setProviderOverride, createDisabled };
}
