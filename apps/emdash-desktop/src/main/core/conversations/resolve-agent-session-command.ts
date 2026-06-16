import type { Conversation } from '@shared/core/conversations/conversations';

/** Some providers need their native session UUID, not the Emdash conversation id, to resume. */
export function resolveAgentSessionCommandArgs(
  conversation: Conversation,
  isResuming: boolean,
  options: { requireProviderSessionId?: boolean } = {}
): { sessionId: string; isResuming: boolean } {
  if (
    (conversation.providerId === 'codex' ||
      conversation.providerId === 'droid' ||
      conversation.providerId === 'pi') &&
    isResuming
  ) {
    if (conversation.providerSessionId) {
      return { sessionId: conversation.providerSessionId, isResuming: true };
    }
    if (options.requireProviderSessionId === false) {
      return { sessionId: conversation.id, isResuming };
    }
    return { sessionId: conversation.id, isResuming: false };
  }

  return { sessionId: conversation.id, isResuming };
}
