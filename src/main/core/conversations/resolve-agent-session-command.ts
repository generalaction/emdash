import { getProvider } from '@shared/agent-provider-registry';
import type { Conversation } from '@shared/conversations';

/**
 * Some CLIs need the provider-native session id for resume. Falling back to
 * their "last session" behavior can attach a different Emdash conversation.
 */
export function resolveAgentSessionCommandArgs(
  conversation: Conversation,
  isResuming: boolean,
  options: { requireProviderSessionId?: boolean } = {}
): { sessionId: string; isResuming: boolean } {
  if (isResuming && getProvider(conversation.providerId)?.resumeRequiresProviderSessionId) {
    if (conversation.providerSessionId) {
      return { sessionId: conversation.providerSessionId, isResuming: true };
    }
    return { sessionId: conversation.id, isResuming: false };
  }

  if (conversation.providerId === 'droid' && isResuming) {
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
