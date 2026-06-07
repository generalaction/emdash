import { type ConversationRow } from '@main/db/schema';
import { type AgentProviderId } from '@shared/core/agents/agent-provider-registry';
import { type AgentStatus } from '@shared/core/agents/agentEvents';
import { type Conversation } from '@shared/core/conversations/conversations';

export function mapConversationRowToConversation(
  row: ConversationRow,
  resume: boolean = false
): Conversation {
  const config = row.config ?? {};
  return {
    id: row.id,
    title: row.title,
    taskId: row.taskId,
    projectId: row.projectId,
    providerId: row.provider as AgentProviderId,
    autoApprove: config.autoApprove,
    providerSessionId: config.providerSessionId,
    uiMode: config.uiMode,
    reasoningEffort: config.reasoningEffort,
    model: config.model,
    serviceTier: config.serviceTier,
    resume: resume,
    lastInteractedAt: row.lastInteractedAt ?? null,
    isInitialConversation: row.isInitialConversation,
    agentStatus: (row.agentStatus as AgentStatus | null) ?? null,
    agentStatusSeen: row.agentStatusSeen === 1,
  };
}
