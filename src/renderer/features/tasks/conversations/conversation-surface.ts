import { isNativeChatProvider } from '@shared/conversation-ui';
import type { Conversation } from '@shared/conversations';

export type ConversationSurface = 'terminal' | 'native-chat';

/**
 * Which surface renders a conversation. Native chat only ever applies to
 * adapter-backed providers whose conversation was created (or switched) in
 * native mode; everything else — including conversations created before the
 * setting was enabled — stays on the terminal.
 */
export function resolveConversationSurface(
  conversation: Pick<Conversation, 'providerId' | 'uiMode'> | undefined
): ConversationSurface {
  if (!conversation) return 'terminal';
  if (!isNativeChatProvider(conversation.providerId)) return 'terminal';
  return conversation.uiMode === 'native-chat' ? 'native-chat' : 'terminal';
}
