import type { AppDb } from '@core/services/app-db/node/db';
import type { AppSettingsService } from '@core/services/settings/node';
import { NotificationService, type NotificationServiceDeps } from './notification-service';
import { installAgentStatusNotificationProducer } from './producers';
import { createSoundNotificationSink, createSystemNotificationSink } from './sinks';
import { SqliteNotificationStore } from './sqlite-store';

export type CreateNotificationServiceDeps = {
  db: AppDb;
  settings: Pick<AppSettingsService, 'get'>;
  isAppFocused(): boolean;
  logger?: NotificationServiceDeps['logger'];
};

export function createNotificationService(
  deps: CreateNotificationServiceDeps
): NotificationService {
  const service = new NotificationService({
    store: new SqliteNotificationStore(deps.db),
    logger: deps.logger,
    async routingContext() {
      return {
        appFocused: deps.isAppFocused(),
        settings: await deps.settings.get('notifications'),
      };
    },
  });

  service.registerSink(createSystemNotificationSink((event) => service.emitDelivery(event)));
  service.registerSink(createSoundNotificationSink((event) => service.emitDelivery(event)));
  service.registerDisposer(installAgentStatusNotificationProducer(service, { db: deps.db }));

  return service;
}
