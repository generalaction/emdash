import { isAppFocused } from '@main/app/window';
import { appSettingsService } from '@main/core/settings/settings-service';
import { db } from '@main/db/client';
import { log } from '@main/lib/logger';
import { NotificationService } from './notification-service';
import { installAgentStatusNotificationProducer } from './producers';
import { createSoundNotificationSink, createSystemNotificationSink } from './sinks';
import { SqliteNotificationStore } from './sqlite-store';

export const notificationService = new NotificationService({
  store: new SqliteNotificationStore(db),
  logger: log,
  async routingContext() {
    return {
      appFocused: isAppFocused(),
      settings: await appSettingsService.get('notifications'),
    };
  },
});

let initialized = false;
let disposeProducer: (() => void) | null = null;

export async function initializeNotificationService(): Promise<void> {
  if (initialized) return;
  initialized = true;

  notificationService.registerSink(
    createSystemNotificationSink((event) => notificationService.emitDelivery(event))
  );
  notificationService.registerSink(
    createSoundNotificationSink((event) => notificationService.emitDelivery(event))
  );
  disposeProducer = installAgentStatusNotificationProducer(notificationService);
  await notificationService.initialize();
}

export function disposeNotificationService(): void {
  disposeProducer?.();
  disposeProducer = null;
  initialized = false;
  notificationService.dispose();
}
