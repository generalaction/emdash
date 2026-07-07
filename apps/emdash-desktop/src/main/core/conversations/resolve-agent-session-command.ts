import type { Conversation } from '@shared/core/conversations/conversations';

const PROVIDER_SESSION_ID_REQUIRED_FOR_RESUME = new Set([
  'amp',
  'codex',
  'commandcode',
  'droid',
  'goose',
  'pi',
]);

/**
 * Resolves the session id and resume flag to pass to the agent CLI.
 *
 * For providers that require a native session id to resume (e.g. Droid, Codex),
 * we resume with conversation.sessionId iff it differs from conversation.id —
 * meaning the agent has reported its own native id that we persisted.
 * Otherwise we fall back to conversation.id with isResuming: false.
 */
export function resolveAgentSessionCommandArgs(
  conversation: Conversation,
  isResuming: boolean,
  options: { requireProviderSessionId?: boolean } = {}
): { sessionId: string; isResuming: boolean } {
  if (PROVIDER_SESSION_ID_REQUIRED_FOR_RESUME.has(conversation.providerId) && isResuming) {
    const nativeSessionId = conversation.sessionId;
    if (nativeSessionId && nativeSessionId !== conversation.id) {
      return { sessionId: nativeSessionId, isResuming: true };
    }
    if (options.requireProviderSessionId === false) {
      return { sessionId: conversation.id, isResuming };
    }
    return { sessionId: conversation.id, isResuming: false };
  }

  return { sessionId: conversation.id, isResuming };
}
