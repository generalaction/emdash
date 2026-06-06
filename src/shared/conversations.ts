import type { AgentProviderId } from '@shared/agent-provider-registry';
import type { ConversationUiMode } from '@shared/conversation-ui';
import type { CodexServiceTier, NativeChatReasoningEffort } from '@shared/native-chat';

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
  /** Rendering surface for this conversation; absent means 'terminal'. */
  uiMode?: ConversationUiMode;
  /** Native chat: reasoning effort override; absent means model default. */
  reasoningEffort?: NativeChatReasoningEffort;
  /** Native chat: model override; absent means the provider's default. */
  model?: string;
  /** Codex native chat: speed (service tier) override; absent means standard. */
  serviceTier?: CodexServiceTier;
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
  isInitialConversation?: boolean;
  initialSize?: { cols: number; rows: number };
  initialPrompt?: string;
};
