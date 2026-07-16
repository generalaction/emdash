import { join } from 'node:path';
import { app } from 'electron';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import {
  mobileAccessClientsChangedChannel,
  mobileAccessStatusChangedChannel,
} from '@shared/events/mobileAccessEvents';
import { attachMobileDomainConnection } from '../mobile-domain/connection';
import { appSettingsService } from '../settings/settings-service';
import { MobileAccessService } from './mobile-access-service';

export const mobileAccessService = new MobileAccessService({
  getSettings: () => appSettingsService.get('mobileAccess'),
  getSpaRoot: () =>
    app.isPackaged
      ? join(app.getAppPath(), 'out', 'mobile')
      : join(app.getAppPath(), '..', 'emdash-mobile', 'dist'),
  logger: log,
  onStatusChanged: (status) => events.emit(mobileAccessStatusChangedChannel, status),
  onClientsChanged: (clients) => events.emit(mobileAccessClientsChangedChannel, clients),
});

mobileAccessService.setAuthenticatedConnectionHandler(attachMobileDomainConnection);
