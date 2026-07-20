import type { SettingsContributionMap } from '@core/primitives/settings/api';
import type { AppDb } from '@core/services/app-db/node/db';
import type { AppSettings, AppSettingsKey } from '../api';
import { SettingsStore } from './settings-store';

export class AppSettingsService {
  constructor(private readonly store: SettingsStore) {}

  get<K extends AppSettingsKey>(key: K): Promise<AppSettings[K]> {
    return this.store.get(key);
  }

  getAll(): Promise<AppSettings> {
    return this.store.getAll();
  }

  getWithMeta<K extends AppSettingsKey>(key: K) {
    return this.store.getWithMeta(key);
  }

  update<K extends AppSettingsKey>(key: K, value: AppSettings[K]): Promise<void> {
    return this.store.update(key, value);
  }

  reset<K extends AppSettingsKey>(key: K): Promise<void> {
    return this.store.reset(key);
  }

  resetField<K extends AppSettingsKey>(key: K, field: keyof AppSettings[K]): Promise<void> {
    return this.store.resetField(key, field);
  }

  initialize(): Promise<void> {
    return this.store.initialize();
  }
}

export function createAppSettingsService(options: {
  db: AppDb;
  contributions: SettingsContributionMap<AppSettings>;
}): AppSettingsService {
  return new AppSettingsService(new SettingsStore(options.db, options.contributions));
}
