import type { Conversation } from '@shared/core/conversations/conversations';

const PROVIDER_SESSION_ID_REQUIRED_FOR_RESUME = new Set(['codex', 'commandcode', 'droid']);

/** Some providers need their native session id, not the Emdash conversation id, to resume. */
export function resolveAgentSessionCommandArgs(
  conversation: Conversation,
  isResuming: boolean,
  options: { requireProviderSessionId?: boolean } = {}
): { sessionId: string; isResuming: boolean } {
  if (PROVIDER_SESSION_ID_REQUIRED_FOR_RESUME.has(conversation.providerId) && isResuming) {
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
