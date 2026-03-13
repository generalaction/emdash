import { createRPCController } from '@/shared/ipc/rpc';
import { appSettingsService, type AppSettings, type AppSettingsKey } from './settings-service';

type ProviderCustomConfig = NonNullable<AppSettings['providerConfigs']>[string];
type UpdatableKey = Exclude<AppSettingsKey, 'providerConfigs'>;

export const appSettingsController = createRPCController({
  get: <T extends AppSettingsKey>(key: T): Promise<AppSettings[T]> =>
    appSettingsService.getAppSettingsKey(key),
  getAll: (): Promise<AppSettings> => appSettingsService.getAllSettings(),
  update: <T extends UpdatableKey>(key: T, value: AppSettings[T]) =>
    appSettingsService.updateSettingsKey(key, value),
  updateProviderConfig: (providerId: string, config: ProviderCustomConfig | undefined) =>
    appSettingsService.updateProviderConfig(providerId, config),
});
