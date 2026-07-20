import {
  notificationService,
  publishUpdateAvailableNotification,
  publishUpdateDownloadedNotification,
  publishUpdateErrorNotification,
} from '@core/services/notifications/node';
import { updateService } from './update-service';

export function installUpdateNotifications(): void {
  updateService.setNotificationPublisher({
    available: (version) => {
      publishUpdateAvailableNotification(notificationService, version);
    },
    downloaded: (version) => {
      publishUpdateDownloadedNotification(notificationService, version);
    },
    error: (message) => {
      publishUpdateErrorNotification(notificationService, message);
    },
  });
}
