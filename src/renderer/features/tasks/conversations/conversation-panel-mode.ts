import type { Conversation } from '@shared/conversations';
import { shouldUseChatRuntime } from '@shared/conversations';

export function getConversationPanelMode(
  conversation: Conversation | undefined
): 'terminal' | 'chat' {
  return conversation && shouldUseChatRuntime(conversation) ? 'chat' : 'terminal';
}
