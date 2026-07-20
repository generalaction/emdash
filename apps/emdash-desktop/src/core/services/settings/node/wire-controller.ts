import { createController, type Controller } from '@emdash/wire/api';
import { setBrowserCorsRelaxationSettings } from '@main/host/browser/browser-profile-session';
import { browserWebContentsRegistry } from '@main/host/browser/browser-webcontents-registry';
import { appSettingsContract, type AppSettings, type AppSettingsKey } from '../api';
import type { AppSettingsService } from './app-settings-service';

async function reconcileSettingsRuntimeState(
  service: AppSettingsService,
  key: AppSettingsKey
): Promise<void> {
  if (key === 'keyboard') {
    browserWebContentsRegistry.setKeyboardSettings(await service.get('keyboard'));
  }
  if (key === 'browser') {
    setBrowserCorsRelaxationSettings(await service.get('browser'));
  }
}

async function updateSetting<K extends AppSettingsKey>(
  service: AppSettingsService,
  key: K,
  value: AppSettings[K]
): Promise<void> {
  await service.update(key, value);
}

async function resetSettingField<K extends AppSettingsKey>(
  service: AppSettingsService,
  key: K,
  field: string
): Promise<void> {
  await service.resetField(key, field as keyof AppSettings[K]);
}

export function createAppSettingsWireController(service: AppSettingsService): Controller {
  return createController(appSettingsContract, {
    get: ({ key }) => service.get(key),
    getAll: () => service.getAll(),
    getWithMeta: ({ key }) => service.getWithMeta(key),
    update: async ({ key, value }) => {
      await updateSetting(service, key, value);
      await reconcileSettingsRuntimeState(service, key);
    },
    reset: async ({ key }) => {
      await service.reset(key);
      await reconcileSettingsRuntimeState(service, key);
    },
    resetField: async ({ key, field }) => {
      await resetSettingField(service, key, field);
      await reconcileSettingsRuntimeState(service, key);
    },
  });
}
