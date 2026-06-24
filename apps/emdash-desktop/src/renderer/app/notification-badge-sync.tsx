import { reaction } from 'mobx';
import { useEffect } from 'react';
import { getVisibleTaskNotificationCount } from '@renderer/features/tasks/stores/task-notifications';
import { rpc } from '@renderer/lib/ipc';
import { appState } from '@renderer/lib/stores/app-state';

export function NotificationBadgeSync() {
  useEffect(
    () =>
      reaction(
        () => {
          const taskParams =
            appState.navigation.currentViewId === 'task'
              ? appState.navigation.viewParamsStore.task
              : undefined;

          return getVisibleTaskNotificationCount(taskParams?.projectId, taskParams?.taskId);
        },
        (count) => {
          void rpc.app.setNotificationBadgeCount(count);
        },
        { fireImmediately: true }
      ),
    []
  );

  return null;
}
