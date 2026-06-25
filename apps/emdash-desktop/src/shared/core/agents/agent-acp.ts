import { getProvider, type AgentProviderId } from './agent-provider-registry';

/**
 * Returns true when the given provider is known to support the ACP
 * (Agent Client Protocol) transport, enabling the structured chat UI.
 */
export function providerSupportsAcp(providerId: AgentProviderId): boolean {
  return Boolean(getProvider(providerId)?.acpCapable);
}
