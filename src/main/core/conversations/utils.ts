import { ProviderId } from '@shared/agent-provider-registry';
import { Conversation } from '@shared/conversations';
import { ConversationRow } from '@main/db/schema';

export function mapConversationRowToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    taskId: row.taskId,
    projectId: row.projectId,
    providerId: row.provider as ProviderId,
    resumeSessionId: row.agentSessionId ?? undefined,
    tmuxSessionId: row.tmuxSessionId ?? undefined,
  };
}
