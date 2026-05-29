import { chatConversationRuntime } from '@main/core/conversations/chat/chat-conversation-runtime';
import type { ConversationProvider } from '@main/core/conversations/types';
import { shouldUseChatRuntime, type Conversation } from '@shared/conversations';

export async function hydrateRestoredConversation(
  conversation: Conversation,
  conversationProvider: ConversationProvider
): Promise<void> {
  if (shouldUseChatRuntime(conversation)) {
    await chatConversationRuntime.hydrateConversation(conversation);
    return;
  }

  await conversationProvider.startSession(conversation, undefined, true);
}
