import { AgentProviderId } from '@shared/agent-provider-registry';
import { Conversation } from '@shared/conversations';
import { ConversationRow } from '@main/db/schema';

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
    resume: resume,
  };
}
