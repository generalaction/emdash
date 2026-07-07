import { createChatContext, type ChatContext } from '@emdash/chat-ui';
import { rpc } from '@renderer/lib/ipc';
import { advertisedCommandProvider } from './advertised-command-provider';
import { chatMentionProvider, registerIssueMentionIcons } from './chat-mention-provider';

let shared: ChatContext | null = null;
let didPreloadIssueMentionIcons = false;

/**
 * Create the process-long ChatContext. Call once from the renderer bootstrap
 * (main.tsx) so the context's font-load hook fires at startup rather than on
 * first conversation open.
 *
 * ChatContext is a global singleton (theme, shared caches, measureEpoch).
 * Per-conversation state lives in ChatState, which is created separately.
 */
export function initSharedChatContext(): ChatContext {
  if (!shared) {
    preloadIssueMentionIcons();
    shared = createChatContext({
      mentionProvider: chatMentionProvider,
      commandProvider: advertisedCommandProvider,
    });
  }
  return shared;
}

/**
 * Access the process-long ChatContext. Lazily initializes as a defensive
 * fallback if a consumer runs before bootstrap completes.
 */
export function getSharedChatContext(): ChatContext {
  return shared ?? initSharedChatContext();
}

function preloadIssueMentionIcons(): void {
  if (didPreloadIssueMentionIcons) return;
  didPreloadIssueMentionIcons = true;
  void rpc.integrations
    .list()
    .then(registerIssueMentionIcons)
    .catch(() => {
      // IntegrationsProvider also refreshes the registry after React mounts.
    });
}
