import type { SettingsContributionMap } from '@core/primitives/settings/api';
import type { AppSettings, AppSettingsKey } from '../api';
import { SettingsStore } from './settings-store';

class AppSettingsService {
  private store: SettingsStore | undefined;

  configure(contributions: SettingsContributionMap<AppSettings>): void {
    if (this.store) return;
    this.store = new SettingsStore(contributions);
  }

  private requireStore(): SettingsStore {
    if (!this.store) {
      throw new Error('App settings service has not been configured');
    }
    return this.store;
  }

  get<K extends AppSettingsKey>(key: K): Promise<AppSettings[K]> {
    return this.requireStore().get(key);
  }

  getAll(): Promise<AppSettings> {
    return this.requireStore().getAll();
  }

  getWithMeta<K extends AppSettingsKey>(key: K) {
    return this.requireStore().getWithMeta(key);
  }

  update<K extends AppSettingsKey>(key: K, value: AppSettings[K]): Promise<void> {
    return this.requireStore().update(key, value);
  }

  reset<K extends AppSettingsKey>(key: K): Promise<void> {
    return this.requireStore().reset(key);
  }

  resetField<K extends AppSettingsKey>(key: K, field: keyof AppSettings[K]): Promise<void> {
    return this.requireStore().resetField(key, field);
  }

  initialize(): Promise<void> {
    return this.requireStore().initialize();
  }
}

export const appSettingsService = new AppSettingsService();

export function configureAppSettingsService(
  contributions: SettingsContributionMap<AppSettings>
): void {
  appSettingsService.configure(contributions);
}
