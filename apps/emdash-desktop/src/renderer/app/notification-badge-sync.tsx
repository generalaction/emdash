import { reaction } from 'mobx';
import { useEffect } from 'react';
import { getVisibleTaskNotificationCount } from '@renderer/features/tasks/stores/task-notifications';
import { rpc } from '@renderer/lib/ipc';

export function NotificationBadgeSync() {
  useEffect(
    () =>
      reaction(
        () => getVisibleTaskNotificationCount(),
        (count) => {
          void rpc.app.setNotificationBadgeCount(count);
        },
        { fireImmediately: true }
      ),
    []
  );

  return null;
}
