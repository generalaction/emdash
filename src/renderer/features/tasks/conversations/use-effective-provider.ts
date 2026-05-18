import { useCallback } from 'react';
import {
  AGENT_PROVIDER_IDS,
  isValidProviderId,
  type AgentProviderId,
} from '@shared/agent-provider-registry';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { appState } from '@renderer/lib/stores/app-state';
import { resolveConversationProviderSelection } from './provider-selection';

export type EffectiveProvider = {
  providerId: AgentProviderId | null;
  setProviderOverride: (id: AgentProviderId | null) => void;
  createDisabled: boolean;
};

export function useEffectiveProvider(
  projectId: string | undefined,
  connectionId?: string
): EffectiveProvider {
  const {
    value: lastAgentByProject,
    update: updateLastAgentByProject,
    resetField: resetLastAgentForProject,
  } = useAppSettingsKey('lastAgentByProject');
  const persistedProviderId = projectId ? lastAgentByProject?.[projectId] : undefined;
  const providerOverride: AgentProviderId | null = isValidProviderId(persistedProviderId)
    ? persistedProviderId
    : null;

  const setProviderOverride = useCallback(
    (id: AgentProviderId | null) => {
      if (!projectId) return;

      if (id) {
        updateLastAgentByProject({ [projectId]: id });
      } else {
        resetLastAgentForProject(projectId);
      }
    },
    [projectId, resetLastAgentForProject, updateLastAgentByProject]
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
