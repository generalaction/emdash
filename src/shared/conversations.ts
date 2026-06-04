import type { AgentProviderId } from '@shared/agent-provider-registry';
import type { ConversationRuntimeKind } from './conversation-runtime';

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
  runtime: ConversationRuntimeKind;
  /** Provider-native session id captured at runtime for per-chat resume. */
  providerSessionId?: string;
  isInitialConversation: boolean | null;
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
  runtime?: ConversationRuntimeKind;
  isInitialConversation?: boolean;
  initialSize?: { cols: number; rows: number };
  initialPrompt?: string;
};
