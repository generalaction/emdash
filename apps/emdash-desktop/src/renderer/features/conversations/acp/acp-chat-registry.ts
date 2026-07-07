import { AcpChatStore } from './acp-chat-store';

/**
 * Singleton registry of per-task AcpChatStore instances.
 *
 * Keyed by taskId (one per task, matching the conversation-registry pattern).
 * The store is keyed by taskId because each task has exactly one ACP
 * conversation at a time — the conversationId is supplied later when the
 * store is actually used.
 */
export class AcpChatRegistry {
  private readonly _entries = new Map<string, Map<string, AcpChatStore>>();

  /**
   * Acquire a store for the given conversationId in the given task.
   * Creates a new store if none exists.
   */
  acquire(conversationId: string, projectId: string, taskId: string): AcpChatStore {
    let taskMap = this._entries.get(taskId);
    if (!taskMap) {
      taskMap = new Map();
      this._entries.set(taskId, taskMap);
    }
    const existing = taskMap.get(conversationId);
    if (existing) return existing;
    const store = new AcpChatStore(conversationId, projectId, taskId);
    taskMap.set(conversationId, store);
    return store;
  }

  /** Return the store for the given conversationId if it exists. */
  get(taskId: string, conversationId: string): AcpChatStore | undefined {
    return this._entries.get(taskId)?.get(conversationId);
  }

  /** Return all stores for the given taskId. */
  getAll(taskId: string): Map<string, AcpChatStore> | undefined {
    return this._entries.get(taskId);
  }

  /** Dispose and remove all stores for the given taskId. */
  release(taskId: string): void {
    const taskMap = this._entries.get(taskId);
    if (!taskMap) return;
    for (const store of taskMap.values()) {
      store.dispose();
    }
    this._entries.delete(taskId);
  }
}

export const acpChatRegistry = new AcpChatRegistry();
