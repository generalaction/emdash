import {
  AGENT_PROVIDER_IDS,
  getProvider,
  isValidProviderId,
  type AgentProviderId,
} from './agent-provider-registry';

export type AgentAutoApproveDefaults = Partial<Record<AgentProviderId, boolean>>;
export type GlobalAutoApproveState = 'none' | 'partial' | 'all';

export function providerSupportsAutoApprove(providerId: AgentProviderId): boolean {
  const provider = getProvider(providerId);
  return Boolean(provider?.autoApproveFlag || provider?.autoApproveViaEnv);
}

export function getAutoApproveCapableProviderIds(): AgentProviderId[] {
  return AGENT_PROVIDER_IDS.filter(providerSupportsAutoApprove);
}

export function getAutoApproveCapableProviderLabels(): string[] {
  return getAutoApproveCapableProviderIds()
    .map((id) => getProvider(id)?.name ?? id)
    .sort((a, b) => a.localeCompare(b));
}

export function getGlobalAutoApproveState(
  defaults: AgentAutoApproveDefaults | undefined
): GlobalAutoApproveState {
  const capableProviderIds = getAutoApproveCapableProviderIds();
  const enabledCount = capableProviderIds.filter((id) =>
    getAgentAutoApproveDefault(defaults, id)
  ).length;

  if (enabledCount === 0) return 'none';
  if (enabledCount === capableProviderIds.length) return 'all';
  return 'partial';
}

export function isGlobalAutoApproveEnabled(
  defaults: AgentAutoApproveDefaults | undefined
): boolean {
  return getGlobalAutoApproveState(defaults) === 'all';
}

export function buildGlobalAutoApproveDefaults(enabled: boolean): AgentAutoApproveDefaults {
  if (!enabled) return {};

  return Object.fromEntries(
    getAutoApproveCapableProviderIds().map((id) => [id, true])
  ) as AgentAutoApproveDefaults;
}

export function getAgentAutoApproveDefault(
  defaults: AgentAutoApproveDefaults | undefined,
  providerId: AgentProviderId
): boolean {
  return defaults?.[providerId] ?? false;
}

export function resolveAgentAutoApprove(
  explicitAutoApprove: boolean | undefined,
  defaults: AgentAutoApproveDefaults | undefined,
  providerId: AgentProviderId
): boolean {
  return explicitAutoApprove ?? getAgentAutoApproveDefault(defaults, providerId);
}

export function resolveAutomationAgentAutoApprove(
  provider: string,
  configured: boolean | undefined
): boolean | undefined {
  if (!isValidProviderId(provider)) return configured;
  return providerSupportsAutoApprove(provider) ? true : configured;
}
