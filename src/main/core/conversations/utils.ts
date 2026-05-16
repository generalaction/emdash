import { type AgentProviderId } from '@shared/agent-provider-registry';
import { type Conversation } from '@shared/conversations';
import { type ConversationRow } from '@main/db/schema';
import { getProviderSessionId } from './impl/droid-session-resolver';

export function mapConversationRowToConversation(
  row: ConversationRow,
  resume: boolean = false
): Conversation {
  return {
    id: row.id,
    title: row.title,
    taskId: row.taskId,
    projectId: row.projectId,
    providerId: row.provider as AgentProviderId,
    autoApprove: row.config ? JSON.parse(row.config).autoApprove : undefined,
    providerSessionId: getProviderSessionId(row.config),
    resume: resume,
    lastInteractedAt: row.lastInteractedAt ?? null,
    isInitialConversation: row.isInitialConversation,
  };
}
