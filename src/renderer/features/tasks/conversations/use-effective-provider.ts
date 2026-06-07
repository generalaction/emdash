import { useState } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { appState } from '@renderer/lib/stores/app-state';
import {
  AGENT_PROVIDER_IDS,
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

  const dependencyResource = connectionId
    ? appState.dependencies.getRemote(connectionId)
    : appState.dependencies.local;
  const availabilityKnown = dependencyResource.data !== null;
  const installedProviderIds = AGENT_PROVIDER_IDS.filter(
    (id) => dependencyResource.data?.[id]?.status === 'available'
  );

  const { providerId, createDisabled } = resolveConversationProviderSelection({
    defaultProviderId,
    providerOverride,
    installedProviderIds,
    availabilityKnown,
  });

  return { providerId, setProviderOverride, createDisabled };
}
