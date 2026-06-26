import { reaction } from 'mobx';
import type { TabHandle, TabResource } from '@renderer/features/tabs/core/tab-provider';
import { setTelemetryConversationScope } from '@renderer/utils/telemetry-scope';
import { conversationRegistry } from '../stores/conversation-registry';
import type { ConversationStore } from './conversation-manager';

/**
 * Domain resource for a single open conversation tab.
 *
 * Wraps ConversationStore, wires up:
 *  - Auto-close when the conversation is deleted from the registry.
 *  - Telemetry scope and mark-seen in onActivate().
 *
 * The PTY session lifecycle (hydrate/dehydrate) is managed separately by
 * ConversationSessionManager (called from the tab provider's initialize/dispose).
 */
export class ConversationTabResource implements TabResource {
  readonly store: ConversationStore;
  private readonly _taskId: string;
  private readonly _disposers: (() => void)[];

  constructor(store: ConversationStore, taskId: string, handle: TabHandle) {
    this.store = store;
    this._taskId = taskId;
    const conversationId = store.data.id;

    this._disposers = [
      // Auto-close this tab when the conversation is deleted.
      reaction(
        () => conversationRegistry.get(taskId)?.conversations.has(conversationId) ?? false,
        (exists) => {
          if (!exists) handle.close();
        }
      ),
    ];
  }

  dispose(): void {
    for (const d of this._disposers) d();
    // Mark conversation as seen on close (mirrors old onClose behavior).
    this.store.markSeen();
  }

  onActivate(): void {
    setTelemetryConversationScope(this.store.data.id);
    if (!this.store.seen) {
      this.store.markSeen();
    }
  }

  rename(name: string): void {
    void conversationRegistry.get(this._taskId)?.renameConversation(this.store.data.id, name);
  }
}
