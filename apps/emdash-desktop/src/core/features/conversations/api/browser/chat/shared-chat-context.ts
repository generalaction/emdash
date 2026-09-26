import type { ChatConfig, ChatContext } from '@emdash/chat-ui';
import { getIntegrationsClient } from '@core/features/integrations/api/browser/client';
import { registerIssueMentionIcons } from '@core/primitives/issues/browser/issue-mention-icons';
import { advertisedCommandProvider } from './advertised-command-provider';
import { CHAT_FONT_MONO, CHAT_FONT_SANS } from './chat-font-stacks';
import { chatMentionProvider } from './chat-mention-provider';
import { getChatUiRuntime } from './chat-ui-runtime';

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
    const runtime = getChatUiRuntime();
    // The transcript renders in the system font stack assigned to --chat-font-sans /
    // --chat-font-mono in index.css. chat-ui pre-measures text with ChatConfig.fonts,
    // so measurement must use the same stacks or lines packed to the column width
    // clip at the right edge.
    const config: ChatConfig = {
      ...runtime.DEFAULT_CONFIG,
      fonts: { sans: CHAT_FONT_SANS, mono: CHAT_FONT_MONO },
    };
    shared = runtime.createChatContext({
      config,
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
  void getIntegrationsClient()
    .then((client) => client.listProviders(undefined))
    .then(registerIssueMentionIcons)
    .catch(() => {
      // IntegrationsProvider also refreshes the registry after React mounts.
    });
}
