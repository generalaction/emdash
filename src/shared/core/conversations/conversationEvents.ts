import type { Conversation } from '@shared/core/conversations/conversations';
import { defineEvent } from '@shared/lib/ipc/events';
import type { AgentStatus } from '../agents/agentEvents';

export const conversationChangedChannel = defineEvent<{
  conversationId: string;
  taskId: string;
  projectId: string;
  changes: Partial<
    Pick<
      Conversation,
      | 'lastInteractedAt'
      | 'title'
      | 'providerSessionId'
      | 'uiMode'
      | 'reasoningEffort'
      | 'model'
      | 'serviceTier'
      | 'autoApprove'
    >
  >;
}>('conversation:changed');

export const conversationCreatedChannel = defineEvent<{
  conversation: Conversation;
}>('conversation:created');

export const conversationAgentStatusChangedChannel = defineEvent<{
  conversationId: string;
  taskId: string;
  projectId: string;
  status: AgentStatus;
  seen: boolean;
  soundEvent?: 'needs_attention' | 'task_complete';
}>('conversation:agent-status-changed');
