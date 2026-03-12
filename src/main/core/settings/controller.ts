import { createRPCController } from '@/shared/ipc/rpc';
import { AppSettings, AppSettingsKey, appSettingsService } from './settings-service';

export const appSettingsController = createRPCController({
  getAll: () => appSettingsService.getAllSettings(),
  get: <T extends AppSettingsKey>(key: T): Promise<AppSettings[T]> =>
    appSettingsService.getAppSettingsKey(key),
  update: <T extends AppSettingsKey>(key: T, value: AppSettings[T]) =>
    appSettingsService.updateSettingsKey(key, value),
});
