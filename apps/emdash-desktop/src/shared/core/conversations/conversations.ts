import type { AgentProviderId } from '@shared/core/agents/agent-provider-registry';
import type { AgentStatus } from '@shared/core/agents/agentEvents';

export const MAX_CONVERSATION_TITLE_LENGTH = 100;

/** Provider IDs that support the ACP (Agent Client Protocol) chat transport. */
export const ACP_CAPABLE_PROVIDER_IDS: ReadonlySet<AgentProviderId> = new Set(['claude']);

export type ConversationType = 'pty' | 'acp';

export type Conversation = {
  id: string;
  projectId: string;
  taskId: string;
  providerId: AgentProviderId;
  title: string;
  lastInteractedAt: string | null;
  resume?: boolean;
  autoApprove?: boolean;
  /** Provider-native session id captured at runtime for per-chat resume. */
  providerSessionId?: string;
  isInitialConversation: boolean | null;
  agentStatus?: AgentStatus | null;
  agentStatusSeen?: boolean;
  type: ConversationType;
  /** Persisted model selection for ACP chat conversations. */
  model?: string;
};

export type RenameConversationParams = {
  conversationId: string;
  newTitle: string;
};

export type CreateConversationParams = {
  id: string;
  projectId: string;
  taskId: string;
  provider: AgentProviderId;
  title: string;
  autoApprove?: boolean;
  isInitialConversation?: boolean;
  initialSize?: { cols: number; rows: number };
  initialPrompt?: string;
  type?: ConversationType;
};
