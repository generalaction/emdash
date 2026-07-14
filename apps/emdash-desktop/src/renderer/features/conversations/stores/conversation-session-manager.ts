import { log } from '@renderer/utils/logger';
import type { ConversationStore } from '../conversation-manager';
import { ConversationHydrationReconciler } from './conversation-hydration-reconciler';
import { conversationRegistry, conversationRegistryKey } from './conversation-registry';

/**
 * Per-task manager that controls conversation PTY-session lifecycle via acquire/release.
 *
 * Thin adapter over ConversationHydrationReconciler: converts the ref-counted
 * acquire/release interface (one call per tab open/close) into the set-diff sync()
 * the reconciler uses.
 *
 * Ref-counting supports the same conversation being open in multiple panes
 * (e.g. restored from a snapshot). The session stays hydrated until the last
 * tab closes.
 *
 * The reconciler handles grace timers and retry logic for dehydration.
 */
export class ConversationSessionManager {
  private readonly _reconciler: ConversationHydrationReconciler;
  /** Ref counts per conversationId — session stays alive while count > 0. */
  private readonly _refCounts = new Map<string, number>();

  constructor(
    private readonly projectId: string,
    private readonly taskId: string
  ) {
    this._reconciler = new ConversationHydrationReconciler({
      taskId,
      getConversations: () => conversationRegistry.get(projectId, taskId),
      log,
    });
  }

  /**
   * Start the PTY session for this conversation (if not already running).
   * Returns the ConversationStore, or undefined if the conversation is not found.
   */
  acquire(conversationId: string): ConversationStore | undefined {
    this._refCounts.set(conversationId, (this._refCounts.get(conversationId) ?? 0) + 1);
    this._reconciler.sync(new Set(this._refCounts.keys()));
    return conversationRegistry.get(this.projectId, this.taskId)?.conversations.get(conversationId);
  }

  /**
   * Signal that this conversation's tab has been closed.
   * The reconciler will dehydrate the PTY session after a grace period
   * once the last reference is released.
   */
  release(conversationId: string): void {
    const count = this._refCounts.get(conversationId) ?? 0;
    if (count <= 1) {
      this._refCounts.delete(conversationId);
    } else {
      this._refCounts.set(conversationId, count - 1);
    }
    this._reconciler.sync(new Set(this._refCounts.keys()));
  }

  dispose(): void {
    this._reconciler.dispose();
    this._refCounts.clear();
  }
}

const _registry = new Map<string, ConversationSessionManager>();

export function getConversationSessionManager(
  projectId: string,
  taskId: string
): ConversationSessionManager {
  const key = conversationRegistryKey(projectId, taskId);
  const existing = _registry.get(key);
  if (existing) return existing;
  const manager = new ConversationSessionManager(projectId, taskId);
  _registry.set(key, manager);
  return manager;
}

export function releaseConversationSessionManager(projectId: string, taskId: string): void {
  const key = conversationRegistryKey(projectId, taskId);
  const manager = _registry.get(key);
  if (!manager) return;
  manager.dispose();
  _registry.delete(key);
}
