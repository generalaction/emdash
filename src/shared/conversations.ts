import { supportsChatUi, type AgentProviderId } from '@shared/agent-provider-registry';

export const MAX_CONVERSATION_TITLE_LENGTH = 100;

export const CONVERSATION_RUNTIME_MODES = ['terminal', 'chat'] as const;
export type ConversationRuntimeMode = (typeof CONVERSATION_RUNTIME_MODES)[number];

const IMPLEMENTED_CHAT_RUNTIME_PROVIDER_IDS: readonly AgentProviderId[] = ['codex'];

export function supportsChatRuntime(providerId: AgentProviderId): boolean {
  return IMPLEMENTED_CHAT_RUNTIME_PROVIDER_IDS.includes(providerId) && supportsChatUi(providerId);
}

export function shouldUseChatRuntime({
  providerId,
  runtimeMode,
}: {
  providerId: AgentProviderId;
  runtimeMode: ConversationRuntimeMode;
}): boolean {
  return runtimeMode === 'chat' && supportsChatRuntime(providerId);
}

export function resolveConversationRuntimeMode({
  providerId,
  requestedMode,
}: {
  providerId: AgentProviderId;
  requestedMode: ConversationRuntimeMode;
}): ConversationRuntimeMode {
  if (requestedMode === 'chat' && supportsChatRuntime(providerId)) return 'chat';
  return 'terminal';
}

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
  runtimeMode: ConversationRuntimeMode;
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
