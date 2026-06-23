import { reaction } from 'mobx';
import { useEffect } from 'react';
import {
  asMounted,
  getProjectManagerStore,
} from '@renderer/features/projects/stores/project-selectors';
import { conversationRegistry } from '@renderer/features/tasks/stores/conversation-registry';
import { isRegistered } from '@renderer/features/tasks/stores/task-store';
import { rpc } from '@renderer/lib/ipc';

function getVisibleNotificationCount(): number {
  let count = 0;

  for (const projectStore of getProjectManagerStore().projects.values()) {
    const mounted = asMounted(projectStore);
    if (!mounted) continue;

    for (const [taskId, taskStore] of mounted.taskManager.tasks) {
      if (!isRegistered(taskStore)) continue;
      if (taskStore.data.archivedAt) continue;

      const conversations = conversationRegistry.get(taskId);
      if (!conversations) continue;

      const status = conversations.taskStatus;
      if (status && status !== 'idle' && status !== 'working') {
        count += 1;
      }
    }
  }

  return count;
}

export function NotificationBadgeSync() {
  useEffect(
    () =>
      reaction(
        () => getVisibleNotificationCount(),
        (count) => {
          void rpc.app.setNotificationBadgeCount(count);
        },
        { fireImmediately: true }
      ),
    []
  );

  return null;
}
