import type { AgentProviderId } from '@shared/core/agents/agent-provider-registry';
import type { AgentStatus } from '@shared/core/agents/agentEvents';

export const MAX_CONVERSATION_TITLE_LENGTH = 100;

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
  /** Model to pass to the agent CLI. Absent or empty string means use the CLI default. */
  model?: string;
  isInitialConversation: boolean | null;
  agentStatus?: AgentStatus | null;
  agentStatusSeen?: boolean;
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
  /** Model to pass to the agent CLI. Absent or empty string means use the CLI default. */
  model?: string;
  isInitialConversation?: boolean;
  initialSize?: { cols: number; rows: number };
  initialPrompt?: string;
};
