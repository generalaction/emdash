import {
  createChatContext,
  DEFAULT_CONFIG,
  type ChatConfig,
  type ChatContext,
  type RoleName,
} from '@emdash/chat-ui';
import { rpc } from '@renderer/lib/ipc';
import { CHAT_FONT_SIZE_DEFAULT } from '@shared/core/chat-settings';
import { advertisedCommandProvider } from './advertised-command-provider';
import { chatMentionProvider, registerIssueMentionIcons } from './chat-mention-provider';

let shared: ChatContext | null = null;
let didPreloadIssueMentionIcons = false;
let currentFontSize = CHAT_FONT_SIZE_DEFAULT;

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

export function setSharedChatFontSize(fontSize: number): void {
  if (fontSize === currentFontSize) return;
  currentFontSize = fontSize;

  const roles: ChatConfig['roles'] = { ...DEFAULT_CONFIG.roles };
  const sizeDelta = fontSize - CHAT_FONT_SIZE_DEFAULT;
  for (const name of Object.keys(roles) as RoleName[]) {
    const role = roles[name];
    roles[name] = {
      ...role,
      size: role.size + sizeDelta,
      lineHeight: role.lineHeight + sizeDelta,
    };
  }

  getSharedChatContext().setConfig({
    ...DEFAULT_CONFIG,
    roles,
  });
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
