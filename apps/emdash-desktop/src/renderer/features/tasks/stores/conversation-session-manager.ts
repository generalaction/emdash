import { log } from '@renderer/utils/logger';
import type { ConversationStore } from '../conversations/conversation-manager';
import { ConversationHydrationReconciler } from './conversation-hydration-reconciler';
import { conversationRegistry } from './conversation-registry';

/**
 * Per-task manager that controls conversation PTY-session lifecycle via retain/release.
 *
 * Thin adapter over ConversationHydrationReconciler: converts the retain/release
 * interface (one call per tab open/close) into the set-diff sync() the reconciler uses.
 *
 * The reconciler handles grace timers and retry logic for dehydration.
 * Since conversation tabs are single-mount, ref count is always 0 or 1.
 */
export class ConversationSessionManager {
  private readonly _reconciler: ConversationHydrationReconciler;
  private readonly _desired = new Set<string>();

  constructor(private readonly taskId: string) {
    this._reconciler = new ConversationHydrationReconciler({
      taskId,
      getConversations: () => conversationRegistry.get(taskId),
      log,
    });
  }

  /**
   * Start the PTY session for this conversation (if not already running).
   * Returns the ConversationStore, or undefined if the conversation is not found.
   */
  retain(conversationId: string): ConversationStore | undefined {
    this._desired.add(conversationId);
    this._reconciler.sync(this._desired);
    return conversationRegistry.get(this.taskId)?.conversations.get(conversationId);
  }

  /**
   * Signal that this conversation's tab has been closed.
   * The reconciler will dehydrate the PTY session after a grace period.
   */
  release(conversationId: string): void {
    this._desired.delete(conversationId);
    this._reconciler.sync(this._desired);
  }

  dispose(): void {
    this._reconciler.dispose();
    this._desired.clear();
  }
}

// ── Registry — one manager per taskId ────────────────────────────────────────

const _registry = new Map<string, ConversationSessionManager>();

export function getConversationSessionManager(taskId: string): ConversationSessionManager {
  const existing = _registry.get(taskId);
  if (existing) return existing;
  const manager = new ConversationSessionManager(taskId);
  _registry.set(taskId, manager);
  return manager;
}

export function releaseConversationSessionManager(taskId: string): void {
  const manager = _registry.get(taskId);
  if (!manager) return;
  manager.dispose();
  _registry.delete(taskId);
}
