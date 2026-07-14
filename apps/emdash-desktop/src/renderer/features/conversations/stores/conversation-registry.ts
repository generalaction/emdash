import { ConversationManagerStore } from '@renderer/features/conversations/conversation-manager';
import type { Conversation } from '@shared/core/conversations/conversations';

export class ConversationRegistry {
  private readonly entries = new Map<string, ConversationManagerStore>();

  acquire(taskId: string, projectId: string, preloaded?: Conversation[]): ConversationManagerStore {
    const existing = this.entries.get(taskId);
    if (existing) return existing;
    const store = new ConversationManagerStore(projectId, taskId, preloaded);
    this.entries.set(taskId, store);
    return store;
  }

  get(taskId: string): ConversationManagerStore | undefined {
    return this.entries.get(taskId);
  }

  getForProject(projectId: string, taskId: string): ConversationManagerStore | undefined {
    const store = this.entries.get(taskId);
    return store?.projectId === projectId ? store : undefined;
  }

  release(taskId: string): void {
    const store = this.entries.get(taskId);
    if (!store) return;
    store.dispose();
    this.entries.delete(taskId);
  }
}

export const conversationRegistry = new ConversationRegistry();
