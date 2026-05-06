import type { AgentProviderId } from './agent-provider-registry';

export type AgentAutoApproveDefaults = Partial<Record<AgentProviderId, boolean>>;

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
