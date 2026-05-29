import type { AgentProviderId } from '@shared/agent-provider-registry';
import type {
  AppendConversationTimelineItemInput,
  ConversationPermissionRequestTimelineItem,
  ConversationPermissionResponse,
  ConversationStatus,
  SendConversationMessageInput,
} from '@shared/conversation-timeline';
import type { Conversation } from '@shared/conversations';

export type ChatProviderRuntimeEvent =
  | { type: 'timeline'; item: AppendConversationTimelineItemInput; upsert?: boolean }
  | { type: 'status'; status: ConversationStatus }
  | { type: 'provider-session'; providerSessionId: string };

export type ChatProviderEventHandler = (event: ChatProviderRuntimeEvent) => void | Promise<void>;

export type AgentSlashCommand = {
  name: string;
  description?: string;
};

export type AgentSlashCommandInput = {
  name: string;
  args?: string;
};

export type ChatSessionConfig = {
  conversation: Conversation;
  cwd: string;
  env?: Record<string, string>;
  onEvent: ChatProviderEventHandler;
};

export interface ChatProviderSession {
  conversationId: string;
  providerId: AgentProviderId;
  providerSessionId?: string;
}

export interface ChatProviderAdapter {
  providerId: AgentProviderId;
  createSession(config: ChatSessionConfig): Promise<ChatProviderSession>;
  resumeSession(config: ChatSessionConfig): Promise<ChatProviderSession>;
  sendMessage(session: ChatProviderSession, input: SendConversationMessageInput): Promise<void>;
  tryHandleOutOfBandCommand?(
    session: ChatProviderSession,
    input: SendConversationMessageInput
  ): Promise<boolean>;
  cancel(session: ChatProviderSession): Promise<void>;
  dispose(session: ChatProviderSession): Promise<void>;
  respondToPermission?(
    session: ChatProviderSession,
    request: ConversationPermissionRequestTimelineItem,
    response: ConversationPermissionResponse
  ): Promise<void>;
  listCommands?(session: ChatProviderSession): Promise<AgentSlashCommand[]>;
  executeSlashCommand?(
    session: ChatProviderSession,
    command: AgentSlashCommandInput
  ): Promise<void>;
}
