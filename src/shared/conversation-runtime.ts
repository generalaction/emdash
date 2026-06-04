import type { AgentProviderDefinition, AgentProviderId } from './agent-provider-registry';

export const CONVERSATION_RUNTIMES = ['terminal', 'acp'] as const;

export type ConversationRuntimeKind = (typeof CONVERSATION_RUNTIMES)[number];

export function providerSupportsAcpRuntime(provider: AgentProviderDefinition | undefined): boolean {
  return provider?.supportsAcp === true && Boolean(provider.acpCommand?.length);
}

export function resolveConversationRuntime({
  provider,
  providerConfig,
  requestedRuntime,
}: {
  provider: AgentProviderDefinition | undefined;
  providerConfig?: {
    defaultConversationRuntime?: ConversationRuntimeKind;
    acpCommand?: readonly string[];
  };
  requestedRuntime?: ConversationRuntimeKind;
}): ConversationRuntimeKind {
  const desired = requestedRuntime ?? providerConfig?.defaultConversationRuntime ?? 'terminal';
  if (desired !== 'acp') return 'terminal';
  const hasAcpCommand = Boolean(providerConfig?.acpCommand?.length || provider?.acpCommand?.length);
  return provider?.supportsAcp === true && hasAcpCommand ? 'acp' : 'terminal';
}

export function isValidConversationRuntime(value: unknown): value is ConversationRuntimeKind {
  return value === 'terminal' || value === 'acp';
}

export type ConversationRuntimeSelection = {
  providerId: AgentProviderId;
  runtime: ConversationRuntimeKind;
};
