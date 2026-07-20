import { createController, type Controller } from '@emdash/wire/api';
import { setBrowserCorsRelaxationSettings } from '@main/host/browser/browser-profile-session';
import { browserWebContentsRegistry } from '@main/host/browser/browser-webcontents-registry';
import { appSettingsContract, type AppSettings, type AppSettingsKey } from '../api';
import { appSettingsService } from './app-settings-service';

async function reconcileSettingsRuntimeState(key: AppSettingsKey): Promise<void> {
  if (key === 'keyboard') {
    browserWebContentsRegistry.setKeyboardSettings(await appSettingsService.get('keyboard'));
  }
  if (key === 'browser') {
    setBrowserCorsRelaxationSettings(await appSettingsService.get('browser'));
  }
}

async function updateSetting<K extends AppSettingsKey>(
  key: K,
  value: AppSettings[K]
): Promise<void> {
  await appSettingsService.update(key, value);
}

async function resetSettingField<K extends AppSettingsKey>(key: K, field: string): Promise<void> {
  await appSettingsService.resetField(key, field as keyof AppSettings[K]);
}

export function createAppSettingsWireController(): Controller {
  return createController(appSettingsContract, {
    get: ({ key }) => appSettingsService.get(key),
    getAll: () => appSettingsService.getAll(),
    getWithMeta: ({ key }) => appSettingsService.getWithMeta(key),
    update: async ({ key, value }) => {
      await updateSetting(key, value);
      await reconcileSettingsRuntimeState(key);
    },
    reset: async ({ key }) => {
      await appSettingsService.reset(key);
      await reconcileSettingsRuntimeState(key);
    },
    resetField: async ({ key, field }) => {
      await resetSettingField(key, field);
      await reconcileSettingsRuntimeState(key);
    },
  });
}
