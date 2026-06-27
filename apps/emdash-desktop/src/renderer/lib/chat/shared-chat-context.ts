import { createChatContext, type ChatContext } from '@emdash/chat-ui';

let shared: ChatContext | null = null;

/**
 * Create the process-long ChatContext. Call once from the renderer bootstrap
 * (main.tsx) so the context's font-load hook fires at startup rather than on
 * first conversation open.
 *
 * ChatContext is a global singleton (theme, shared caches, measureEpoch).
 * Per-conversation state lives in ChatState, which is created separately.
 */
export function initSharedChatContext(): ChatContext {
  if (!shared) shared = createChatContext();
  return shared;
}

/**
 * Access the process-long ChatContext. Lazily initializes as a defensive
 * fallback if a consumer runs before bootstrap completes.
 */
export function getSharedChatContext(): ChatContext {
  return shared ?? initSharedChatContext();
}
