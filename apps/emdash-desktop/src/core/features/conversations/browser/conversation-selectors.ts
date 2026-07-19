import {
  isProvisioned,
  isUnregistered,
  type TaskStore,
} from '@core/features/tasks/browser/stores/task-store';
import type { AgentStatus } from '@core/primitives/agents/api';
import type { Task } from '@core/primitives/tasks/api';
import { conversationRegistry } from './stores/conversation-registry';

export function getConversationsForTask(taskId: string) {
  return conversationRegistry.get(taskId);
}

export function taskAgentStatus(store: TaskStore): AgentStatus | null {
  return conversationRegistry.get(store.data.id)?.taskStatus ?? null;
}

export function taskConversationStats(store: TaskStore): Record<string, number> {
  if (isUnregistered(store)) return {};
  if (isProvisioned(store)) {
    const manager = conversationRegistry.get(store.data.id);
    if (manager) {
      const counts: Record<string, number> = {};
      for (const conversation of manager.conversations.values()) {
        const id = conversation.data.providerId;
        counts[id] = (counts[id] ?? 0) + 1;
      }
      return counts;
    }
  }
  return (store.data as Task).conversations;
}
