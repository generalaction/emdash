import { type ConversationRow } from '@main/db/schema';
import { type AgentProviderId } from '@shared/agent-provider-registry';
import { type Conversation } from '@shared/conversations';
import { type AgentStatus } from '@shared/events/agentEvents';

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
    resume: resume,
    lastInteractedAt: row.lastInteractedAt ?? null,
    isInitialConversation: row.isInitialConversation,
    agentStatus: (row.agentStatus as AgentStatus | null) ?? null,
    agentStatusSeen: row.agentStatusSeen === 1,
  };
}
