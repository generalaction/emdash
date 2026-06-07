import { getProvider, isValidProviderId, type AgentProviderId } from './agent-provider-registry';

export type AgentAutoApproveDefaults = Partial<Record<AgentProviderId, boolean>>;

export function providerSupportsAutoApprove(providerId: AgentProviderId): boolean {
  const provider = getProvider(providerId);
  return Boolean(provider?.autoApproveFlag || provider?.autoApproveViaEnv);
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
