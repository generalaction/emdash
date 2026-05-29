import type { ConversationProvider } from '@main/core/conversations/types';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import type {
  AppendConversationTimelineItemInput,
  ConversationPermissionRequestTimelineItem,
  ConversationPermissionResponse,
  ConversationStatus,
} from '@shared/conversation-timeline';
import type { Conversation } from '@shared/conversations';
import type { AgentEvent } from '@shared/events/agentEvents';

export type ChatProviderBackend = Pick<
  ConversationProvider,
  'sendInput' | 'interruptSession' | 'waitUntilReadyForInput'
>;

export type ChatProviderRuntimeEvent =
  | { type: 'timeline'; item: AppendConversationTimelineItemInput }
  | { type: 'status'; status: ConversationStatus };

export interface ChatProviderAdapter {
  providerId: AgentProviderId;
  buildMessageInput(conversation: Conversation, text: string): string;
  cancel(conversation: Conversation, backend: ChatProviderBackend): Promise<void>;
  mapAgentEvent(event: AgentEvent): ChatProviderRuntimeEvent[];
  respondToPermission?(
    conversation: Conversation,
    backend: ChatProviderBackend,
    request: ConversationPermissionRequestTimelineItem,
    response: ConversationPermissionResponse
  ): Promise<void>;
}
