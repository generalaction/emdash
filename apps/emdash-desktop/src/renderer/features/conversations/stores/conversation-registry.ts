import { ConversationManagerStore } from '@renderer/features/conversations/conversation-manager';
import type { Conversation } from '@shared/core/conversations/conversations';

export class ConversationRegistry {
  private readonly entries = new Map<string, ConversationManagerStore>();

  acquire(projectId: string, taskId: string, preloaded?: Conversation[]): ConversationManagerStore {
    const key = conversationRegistryKey(projectId, taskId);
    const existing = this.entries.get(key);
    if (existing) return existing;
    const store = new ConversationManagerStore(projectId, taskId, preloaded);
    this.entries.set(key, store);
    return store;
  }

  get(projectId: string, taskId: string): ConversationManagerStore | undefined {
    return this.entries.get(conversationRegistryKey(projectId, taskId));
  }

  release(projectId: string, taskId: string): void {
    const key = conversationRegistryKey(projectId, taskId);
    const store = this.entries.get(key);
    if (!store) return;
    store.dispose();
    this.entries.delete(key);
  }
}

export function conversationRegistryKey(projectId: string, taskId: string) {
  return JSON.stringify([projectId, taskId]);
}

export const conversationRegistry = new ConversationRegistry();
