import { AGENT_PROVIDER_IDS, AgentProviderId } from '@shared/agent-provider-registry';

type ResolveConversationProviderSelectionParams = {
  defaultProviderId: AgentProviderId;
  providerOverride: AgentProviderId | null;
  installedProviderIds: AgentProviderId[];
  availabilityKnown: boolean;
};

export type ConversationProviderSelection = {
  providerId: AgentProviderId | null;
  createDisabled: boolean;
};

export function resolveConversationProviderSelection({
  defaultProviderId,
  providerOverride,
  installedProviderIds,
  availabilityKnown,
}: ResolveConversationProviderSelectionParams): ConversationProviderSelection {
  const installedSet = new Set(installedProviderIds);
  const fallbackProviderId =
    availabilityKnown && !installedSet.has(defaultProviderId)
      ? AGENT_PROVIDER_IDS.find((id) => installedSet.has(id))
      : undefined;

  const noInstalledAgents = availabilityKnown && installedSet.size === 0;
  const effectiveDefaultProviderId = noInstalledAgents
    ? null
    : (fallbackProviderId ?? defaultProviderId);
  const providerId = providerOverride ?? effectiveDefaultProviderId;
  const providerInstalled = providerId ? installedSet.has(providerId) : false;

  return {
    providerId,
    createDisabled: providerId === null || (availabilityKnown && !providerInstalled),
  };
}
