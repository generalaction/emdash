import { createRPCController } from '@/shared/ipc/rpc';
import { appSettingsService, type AppSettings, type AppSettingsKey } from './settings-service';

export const appSettingsController = createRPCController({
  get: <T extends AppSettingsKey>(key: T): Promise<AppSettings[T]> => appSettingsService.get(key),

  getAll: (): Promise<AppSettings> => appSettingsService.getAll(),

  getWithMeta: <T extends AppSettingsKey>(
    key: T
  ): Promise<{
    value: AppSettings[T];
    defaults: AppSettings[T];
    overrides: Partial<AppSettings[T]>;
  }> => appSettingsService.getWithMeta(key),

  update: <T extends AppSettingsKey>(key: T, value: AppSettings[T]): Promise<void> =>
    appSettingsService.update(key, value),

  reset: <T extends AppSettingsKey>(key: T): Promise<void> => appSettingsService.reset(key),

  resetField: <T extends AppSettingsKey>(key: T, field: string): Promise<void> =>
    appSettingsService.resetField(key, field as keyof AppSettings[T]),
});
