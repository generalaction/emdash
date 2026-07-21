import { reaction, runInAction } from 'mobx';
import type { ConversationManagerStore } from '@core/features/conversations/api/browser/conversation-manager';
import type { PaneLayoutStore } from '@core/primitives/workbench-shell/browser/tabs/pane-layout-store';

/**
 * Seeds the one automatic default conversation tab for a fresh task.
 *
 * - Suppressed when restored tab state already existed (`markConsumed(true)`).
 * - Handles the optimistic-conversation case: conversations may appear in the
 *   registry before provision completes, so a reaction fires immediately on
 *   the first non-empty conversation list and then self-disposes.
 * - `seed()` is also called directly in `initialize()` to cover the case where
 *   conversations already exist when the task becomes provisioned.
 */
export class DefaultConversationSeeder {
  private _consumed = false;
  private _disposer: () => void;

  constructor(
    private readonly conversations: ConversationManagerStore,
    private readonly paneLayout: PaneLayoutStore
  ) {
    this._disposer = reaction(
      () => this.conversations.conversations.size,
      (size) => {
        if (size === 0) return;
        this.seed();
        this._disposer();
      }
    );
  }

  /** Call with the return value of paneLayout.hydrate() to suppress seeding when tabs were restored. */
  markConsumed(consumed: boolean): void {
    this._consumed = consumed;
  }

  /** Opens the initial conversation tab for a fresh task, exactly once. */
  seed(): void {
    if (this._consumed) return;
    if (this.conversations.conversations.size === 0) return;

    this._consumed = true;
    if (this.paneLayout.focusedPane.tabOrder.length !== 0) return;

    runInAction(() => {
      for (const [id, store] of this.conversations.conversations) {
        if (store.isInitialConversation) {
          if (store.data.type === 'acp') {
            this.paneLayout.open('acp-chat', { conversationId: id }, { preview: false });
          } else {
            this.paneLayout.open('conversation', { conversationId: id }, { preview: false });
          }
          return;
        }
      }
    });
  }

  dispose(): void {
    this._disposer();
  }
}
