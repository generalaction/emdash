import { action, makeObservable, observable } from 'mobx';

/**
 * Observable entry for a single ACP-chat tab.
 * Owned by PaneStore; its identity fields are persisted via acpChatTabProvider.
 */
export class AcpChatTabEntry {
  readonly kind = 'acp-chat' as const;
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
