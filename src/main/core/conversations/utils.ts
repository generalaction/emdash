import { type ConversationRow } from '@main/db/schema';
import { type AgentProviderId } from '@shared/agent-provider-registry';
import { parseConversationConfig } from '@shared/conversation-config';
import { type Conversation } from '@shared/conversations';

export function mapConversationRowToConversation(
  row: ConversationRow,
  resume: boolean = false
): Conversation {
  const config = parseConversationConfig(row.config);
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
    runtimeMode: row.runtimeMode ?? 'terminal',
  };
}
