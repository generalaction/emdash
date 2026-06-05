/**
 * How a conversation is rendered and driven in the renderer.
 *
 * - 'terminal': the provider CLI runs in a PTY and is rendered through the
 *   terminal (current behavior for all providers).
 * - 'native-chat': experimental native chat surface. Adapter-backed providers
 *   run non-interactive structured streams instead of the interactive TUI.
 */
export const CONVERSATION_UI_MODES = ['terminal', 'native-chat'] as const;

export type ConversationUiMode = (typeof CONVERSATION_UI_MODES)[number];

export const DEFAULT_CONVERSATION_UI_MODE: ConversationUiMode = 'terminal';

/** Providers with a native chat adapter (structured non-interactive stream). */
export const NATIVE_CHAT_PROVIDER_IDS = ['codex', 'claude', 'pi'] as const;

export type NativeChatProviderId = (typeof NATIVE_CHAT_PROVIDER_IDS)[number];

export function isNativeChatProvider(value: string): value is NativeChatProviderId {
  return (NATIVE_CHAT_PROVIDER_IDS as readonly string[]).includes(value);
}
