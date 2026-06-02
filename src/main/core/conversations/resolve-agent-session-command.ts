import type { Conversation } from '@shared/conversations';

/** Droid `--resume` needs the provider-native session UUID, not the Emdash conversation id. */
export function resolveAgentSessionCommandArgs(
  conversation: Conversation,
  isResuming: boolean,
  options: { requireProviderSessionId?: boolean } = {}
): { sessionId: string; isResuming: boolean } {
  if ((conversation.providerId === 'codex' || conversation.providerId === 'droid') && isResuming) {
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
