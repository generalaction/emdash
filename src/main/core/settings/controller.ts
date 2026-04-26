import { createRPCController } from '@/shared/ipc/rpc';
import {
  startResourceSampler,
  stopResourceSampler,
} from '@main/core/resource-monitor/resource-sampler';
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
    if (key === 'resourceMonitor') {
      const { enabled } = value as AppSettings['resourceMonitor'];
      if (enabled) startResourceSampler();
      else stopResourceSampler();
    }
  },

  reset: async <T extends AppSettingsKey>(key: T): Promise<void> => {
    await appSettingsService.reset(key);
    if (key === 'resourceMonitor') stopResourceSampler();
  },

  resetField: async <T extends AppSettingsKey>(key: T, field: string): Promise<void> => {
    await appSettingsService.resetField(key, field as keyof AppSettings[T]);
    if (key === 'resourceMonitor' && field === 'enabled') stopResourceSampler();
  },
});
