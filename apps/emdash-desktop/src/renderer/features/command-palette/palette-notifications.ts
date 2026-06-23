import {
  asMounted,
  getProjectManagerStore,
} from '@renderer/features/projects/stores/project-selectors';
import type { ConversationStore } from '@renderer/features/tasks/conversations/conversation-manager';
import { conversationRegistry } from '@renderer/features/tasks/stores/conversation-registry';
import { isRegistered, type TaskStore } from '@renderer/features/tasks/stores/task-store';

export type NotificationItem =
  | { kind: 'task'; projectId: string; taskStore: TaskStore }
  | { kind: 'conversation'; projectId: string; taskId: string; conv: ConversationStore };

export function getPaletteNotificationItems(
  currentProjectId: string | undefined,
  currentTaskId: string | undefined
): NotificationItem[] {
  const result: NotificationItem[] = [];

  for (const projectStore of getProjectManagerStore().projects.values()) {
    const mounted = asMounted(projectStore);
    if (!mounted) continue;
    const pid = mounted.data.id;

    for (const [tid, taskStore] of mounted.taskManager.tasks) {
      if (!isRegistered(taskStore)) continue;
      const conversations = conversationRegistry.get(tid);
      if (!conversations) continue;

      const status = conversations.taskStatus;
      if (!status || status === 'idle' || status === 'working') continue;

      if (pid === currentProjectId && tid === currentTaskId) {
        for (const conv of conversations.conversations.values()) {
          if (!conv.seen && conv.indicatorStatus) {
            result.push({ kind: 'conversation', projectId: pid, taskId: tid, conv });
          }
        }
      } else {
        result.push({ kind: 'task', projectId: pid, taskStore });
      }
    }
  }

  return result;
}
