import type { AgentProviderId } from '@emdash/plugins/agents';
import type { AgentStatus } from '@shared/core/agents/agentEvents';

export const MAX_CONVERSATION_TITLE_LENGTH = 100;

export type ConversationType = 'pty' | 'acp';

export type InitialQueuePrompt = {
  text: string;
  hiddenContext?: string;
};

export type Conversation = {
  id: string;
  projectId: string;
  taskId: string;
  providerId: AgentProviderId;
  title: string;
  lastInteractedAt: string | null;
  autoApprove?: boolean;
  /**
   * The agent-facing session identifier. Null / absent means the conversation has never
   * successfully established a session.
   *
   * PTY conversations write a conversation.id placeholder only after the first fresh
   * process is spawned; provider hooks may later overwrite it with a native id. ACP
   * conversations store the id returned by newSession/loadSession.
   */
  sessionId?: string;
  /** Model to pass to the agent CLI. Absent or empty string means use the CLI default. */
  model?: string;
  /** Initial queued prompts to deliver on first ACP spawn. Only present before sessionId is set. */
  initialQueue?: InitialQueuePrompt[];
  isInitialConversation: boolean | null;
  agentStatus?: AgentStatus | null;
  agentStatusSeen?: boolean;
  /** Transport type: 'pty' (default) uses the terminal/PTY path; 'acp' uses the Agent Client Protocol. */
  type?: ConversationType;
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
  initialQueue?: InitialQueuePrompt[];
  /** Transport type: 'pty' (default) uses the terminal/PTY path; 'acp' uses the Agent Client Protocol. */
  type?: ConversationType;
};
