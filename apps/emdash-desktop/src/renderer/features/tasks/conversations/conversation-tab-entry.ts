import { action, makeObservable, observable } from 'mobx';

/**
 * Observable entry for a single conversation tab.
 * Owned by PaneStore; its identity fields are persisted via the conversation TabProvider.
 */
export class ConversationTabEntry {
  readonly kind = 'conversation' as const;
  readonly tabId: string;
  conversationId: string;
  isPreview: boolean;

  constructor(conversationId: string, isPreview: boolean, tabId?: string) {
    this.tabId = tabId ?? crypto.randomUUID();
    this.conversationId = conversationId;
    this.isPreview = isPreview;
    makeObservable(this, {
      conversationId: observable,
      isPreview: observable,
      pin: action,
    });
  }

  pin(): void {
    this.isPreview = false;
  }
}
