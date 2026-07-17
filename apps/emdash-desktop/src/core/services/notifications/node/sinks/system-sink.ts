import { Notification } from 'electron';
import { focusAppFromNotification } from '@main/host/window';
import type { EmitNotificationDelivery, NotificationSink } from '../../api/ports';

export function createSystemNotificationSink(
  emitDelivery: EmitNotificationDelivery
): NotificationSink {
  const active = new Map<string, Notification>();

  return {
    id: 'system',
    deliver({ notification, summary }) {
      if (!Notification.isSupported()) return;

      active.get(notification.groupKey)?.close();

      const banner = new Notification({
        title: summary.title,
        body: summary.body,
        silent: true,
      });
      active.set(notification.groupKey, banner);

      const release = () => {
        if (active.get(notification.groupKey) === banner) {
          active.delete(notification.groupKey);
        }
      };
      banner.on('close', release);
      banner.on('failed', release);
      banner.on('click', () => {
        focusAppFromNotification();
        release();
        emitDelivery({
          type: 'open',
          notificationId: notification.id,
          target: notification.target,
        });
      });

      banner.show();
    },
  };
}
