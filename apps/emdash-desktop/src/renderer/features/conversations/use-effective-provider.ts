import type { AgentProviderId } from '@emdash/plugins/agents';
import { useMemo, useState } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useAgentInstallationStatuses } from '@renderer/lib/stores/use-agent-installation-statuses';
import { useAgents } from '@renderer/lib/stores/use-agents';
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
  const { data: agents } = useAgents();
  const orderedProviderIds = useMemo(
    () => (agents ?? []).map((agent) => agent.id as AgentProviderId),
    [agents]
  );
  const defaultProviderId =
    defaultAgentValue && orderedProviderIds.includes(defaultAgentValue) ? defaultAgentValue : null;

  const { data: statuses } = useAgentInstallationStatuses(connectionId);
  const availabilityKnown = statuses !== undefined;

  const installedProviderIds = useMemo(
    () =>
      (statuses ?? []).filter((s) => s.status === 'available').map((s) => s.id as AgentProviderId),
    [statuses]
  );

  const { providerId, createDisabled } = resolveConversationProviderSelection({
    orderedProviderIds,
    defaultProviderId,
    providerOverride,
    installedProviderIds,
    availabilityKnown,
  });

  return { providerId, setProviderOverride, createDisabled };
}
