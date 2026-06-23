/**
 * Pane selectors for the conversations domain.
 *
 * These helpers let conversation UI read conversation-tab state from a generic
 * PaneStore without the engine having to know about ConversationTabEntry.
 */
import type { PaneStore } from '@renderer/features/tabs/pane-store';
import type { ConversationManagerStore, ConversationStore } from './conversation-manager';

interface ConversationTabLike {
  readonly kind: 'conversation';
  readonly tabId: string;
  isPreview: boolean;
  conversationId: string;
}

export function activeConversationId(pane: PaneStore): string | undefined {
  const entry = pane.activeEntryOfKind<ConversationTabLike>('conversation');
  return entry?.conversationId;
}

export function activeConversation(
  pane: PaneStore,
  conversations: ConversationManagerStore
): ConversationStore | undefined {
  const id = activeConversationId(pane);
  return id ? conversations.conversations.get(id) : undefined;
}
