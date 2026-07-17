import type { AgentProviderId } from '@emdash/plugins/agents';
import { type AgentStatus } from '@core/primitives/agents/api';
import {
  type Conversation,
  type ConversationType,
  type InitialQueuePrompt,
} from '@core/primitives/conversations/api';
import { type ConversationRow } from '@main/db/schema';

function initialQueueFromRow(row: ConversationRow): InitialQueuePrompt[] | undefined {
  if (row.sessionId !== null) return undefined;
  const config = row.config;
  if (config?.type !== 'acp') return undefined;
  if (config.initialQueue?.length) return config.initialQueue;
  const legacyPrompt = config.initialPrompt?.trim();
  return legacyPrompt ? [{ text: legacyPrompt }] : undefined;
}

export function mapConversationRowToConversation(row: ConversationRow): Conversation {
  const config = row.config;
  return {
    id: row.id,
    title: row.title,
    taskId: row.taskId,
    projectId: row.projectId,
    providerId: row.provider as AgentProviderId,
    autoApprove: config?.autoApprove,
    sessionId: row.sessionId ?? undefined,
    model: config?.model,
    modeId: config?.type === 'acp' ? config.modeId : undefined,
    initialQueue: initialQueueFromRow(row),
    lastInteractedAt: row.lastInteractedAt ?? null,
    isInitialConversation: row.isInitialConversation,
    agentStatus: (row.agentStatus as AgentStatus | null) ?? null,
    agentStatusSeen: row.agentStatusSeen === 1,
    type: (row.type as ConversationType | null) ?? 'pty',
  };
}
