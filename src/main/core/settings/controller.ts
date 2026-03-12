import { createRPCController } from '@/shared/ipc/rpc';
import { settingsService } from './settings-service';
import { type AppSettingsUpdate } from './utils';

export const appSettingsController = createRPCController({
  get: () => settingsService.getAppSettings(),
  update: (partial: AppSettingsUpdate) => settingsService.updateAppSettings(partial ?? {}),
});
