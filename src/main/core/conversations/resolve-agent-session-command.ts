import type { Conversation } from '@shared/conversations';

/** OpenCode `--continue` resumes the last global session, not per Emdash chat. */
export function resolveAgentSessionCommandArgs(
  conversation: Conversation,
  isResuming: boolean
): { sessionId: string; isResuming: boolean } {
  if (conversation.providerId === 'opencode' && isResuming) {
    if (conversation.providerSessionId) {
      return { sessionId: conversation.providerSessionId, isResuming: true };
    }
    return { sessionId: conversation.id, isResuming: false };
  }

  return { sessionId: conversation.id, isResuming };
}
