import { createRPCController } from '@/shared/ipc/rpc';
import { appIconService } from '@main/core/app-icon/service';
import { reconcileResourceSampler } from '@main/core/resource-monitor/resource-sampler';
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

  update: async <T extends AppSettingsKey>(key: T, value: AppSettings[T]): Promise<void> => {
    await appSettingsService.update(key, value);
    if (key === 'resourceMonitor') await reconcileResourceSampler();
    if (key === 'appIcon') appIconService.apply((value as AppSettings['appIcon']).icon);
  },

  reset: async <T extends AppSettingsKey>(key: T): Promise<void> => {
    await appSettingsService.reset(key);
    if (key === 'resourceMonitor') await reconcileResourceSampler();
    if (key === 'appIcon') {
      const value = await appSettingsService.get('appIcon');
      appIconService.apply(value.icon);
    }
  },

  resetField: async <T extends AppSettingsKey>(key: T, field: string): Promise<void> => {
    await appSettingsService.resetField(key, field as keyof AppSettings[T]);
    if (key === 'resourceMonitor') await reconcileResourceSampler();
  },
});
