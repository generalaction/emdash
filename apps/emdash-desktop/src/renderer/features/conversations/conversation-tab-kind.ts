import type { ConversationType } from '@shared/core/conversations/conversations';

/**
 * Maps a conversation type to the corresponding tab kind so callers
 * don't have to branch on 'acp' vs 'pty' inline.
 */
export function conversationTabKind(
  type: ConversationType | undefined
): 'conversation' | 'acp-chat' {
  return type === 'acp' ? 'acp-chat' : 'conversation';
}
