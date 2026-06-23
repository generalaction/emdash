import {
  asMounted,
  getProjectManagerStore,
} from '@renderer/features/projects/stores/project-selectors';
import type { ConversationStore } from '@renderer/features/tasks/conversations/conversation-manager';
import { conversationRegistry } from '@renderer/features/tasks/stores/conversation-registry';
import { isRegistered, type TaskStore } from '@renderer/features/tasks/stores/task-store';

export type TaskNotificationItem =
  | { kind: 'task'; projectId: string; taskStore: TaskStore }
  | { kind: 'conversation'; projectId: string; taskId: string; conv: ConversationStore };

function hasVisibleTaskNotification(taskId: string): boolean {
  const conversations = conversationRegistry.get(taskId);
  if (!conversations) return false;

  const status = conversations.taskStatus;
  return status !== null && status !== 'idle' && status !== 'working';
}

export function getVisibleTaskNotificationCount(): number {
  let count = 0;

  for (const projectStore of getProjectManagerStore().projects.values()) {
    const mounted = asMounted(projectStore);
    if (!mounted) continue;

    for (const [taskId, taskStore] of mounted.taskManager.tasks) {
      if (!isRegistered(taskStore)) continue;
      if (hasVisibleTaskNotification(taskId)) count += 1;
    }
  }

  return count;
}

export function getTaskNotificationItems(
  currentProjectId: string | undefined,
  currentTaskId: string | undefined
): TaskNotificationItem[] {
  const result: TaskNotificationItem[] = [];

  for (const projectStore of getProjectManagerStore().projects.values()) {
    const mounted = asMounted(projectStore);
    if (!mounted) continue;
    const projectId = mounted.data.id;

    for (const [taskId, taskStore] of mounted.taskManager.tasks) {
      if (!isRegistered(taskStore)) continue;
      if (!hasVisibleTaskNotification(taskId)) continue;

      if (projectId === currentProjectId && taskId === currentTaskId) {
        const conversations = conversationRegistry.get(taskId);
        if (!conversations) continue;

        for (const conversation of conversations.conversations.values()) {
          if (!conversation.seen && conversation.indicatorStatus) {
            result.push({
              kind: 'conversation',
              projectId,
              taskId,
              conv: conversation,
            });
          }
        }
      } else {
        result.push({ kind: 'task', projectId, taskStore });
      }
    }
  }

  return result;
}
