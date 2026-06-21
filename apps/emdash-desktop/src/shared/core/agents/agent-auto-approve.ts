import { getProvider, isValidProviderId, type AgentProviderId } from './agent-provider-registry';

export function providerSupportsAutoApprove(providerId: AgentProviderId): boolean {
  const provider = getProvider(providerId);
  return Boolean(provider?.autoApproveFlag || provider?.autoApproveViaEnv);
}

export function resolveAutomationAgentAutoApprove(
  provider: string,
  configured: boolean | undefined
): boolean | undefined {
  if (!isValidProviderId(provider)) return configured;
  return providerSupportsAutoApprove(provider) ? true : configured;
}
