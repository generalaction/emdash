import { type ConversationRow } from '@main/db/schema';
import { type AgentProviderId } from '@shared/core/agents/agent-provider-registry';
import { type AgentStatus } from '@shared/core/agents/agentEvents';
import { type Conversation, type ConversationType } from '@shared/core/conversations/conversations';

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
    // All provider session IDs now live in the sessionId column.
    // For PTY conversations, sessionId === id is the idempotency guard (not a real session ID).
    providerSessionId:
      row.type === 'acp'
        ? (row.sessionId ?? undefined)
        : row.sessionId !== null && row.sessionId !== row.id
          ? row.sessionId
          : undefined,
    resume: resume,
    lastInteractedAt: row.lastInteractedAt ?? null,
    isInitialConversation: row.isInitialConversation,
    agentStatus: (row.agentStatus as AgentStatus | null) ?? null,
    agentStatusSeen: row.agentStatusSeen === 1,
    type: (row.type as ConversationType) ?? 'pty',
    model: config.model,
  };
}
