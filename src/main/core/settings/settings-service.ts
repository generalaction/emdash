import { eq } from 'drizzle-orm';
import { AppSettingsKeys, type AppSettings, type AppSettingsKey } from '@shared/app-settings';
import { db } from '@main/db/client';
import { appSettings } from '@main/db/schema';
import {
  APP_SETTINGS_SCHEMA_MAP,
  providerConfigDefaults,
  providerConfigOverridesSchema,
} from './schema';

export type { AppSettings, AppSettingsKey } from '@shared/app-settings';
export { AppSettingsKeys } from '@shared/app-settings';

type ProviderCustomConfig = NonNullable<AppSettings['providerConfigs']>[string];
type ProviderCustomConfigs = NonNullable<AppSettings['providerConfigs']>;

// Merges stored overrides with current registry defaults to produce the full config.
function fromOverrides(stored: ProviderCustomConfigs): ProviderCustomConfigs {
  const result: ProviderCustomConfigs = {};
  const allIds = new Set([...Object.keys(providerConfigDefaults), ...Object.keys(stored)]);
  for (const id of allIds) {
    const def = (providerConfigDefaults as Record<string, ProviderCustomConfig>)[id] ?? {};
    const override = stored[id] ?? {};
    result[id] = { ...def, ...override } as ProviderCustomConfig;
  }
  return result;
}

class AppSettingsService {
  private cache: Partial<AppSettings> = {};

  async getAppSettingsKey<T extends AppSettingsKey>(key: T): Promise<AppSettings[T]> {
    if (key in this.cache) return this.cache[key] as AppSettings[T];

    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).execute();

    let value: AppSettings[T];
    if (row) {
      const raw = JSON.parse(row.value);
      value =
        key === 'providerConfigs'
          ? (fromOverrides(providerConfigOverridesSchema.parse(raw)) as AppSettings[T])
          : (APP_SETTINGS_SCHEMA_MAP[key].parse(raw) as AppSettings[T]);
    } else {
      value =
        key === 'providerConfigs'
          ? (fromOverrides({}) as AppSettings[T])
          : (APP_SETTINGS_SCHEMA_MAP[key].parse(undefined) as AppSettings[T]);
    }

    this.cache[key] = value;
    return value;
  }

  // providerConfigs is intentionally excluded — writes must go through updateProviderConfig.
  async updateSettingsKey<T extends Exclude<AppSettingsKey, 'providerConfigs'>>(
    key: T,
    value: AppSettings[T]
  ): Promise<void> {
    const serialized = JSON.stringify(APP_SETTINGS_SCHEMA_MAP[key].parse(value));

    await db
      .insert(appSettings)
      .values({ key, value: serialized })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: serialized } })
      .execute();

    this.cache[key] = value;
  }

  async updateProviderConfig(
    providerId: string,
    config: ProviderCustomConfig | undefined
  ): Promise<void> {
    const [row] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, 'providerConfigs'))
      .execute();

    const storedOverrides: ProviderCustomConfigs = row
      ? providerConfigOverridesSchema.parse(JSON.parse(row.value))
      : {};

    if (config === undefined) {
      delete storedOverrides[providerId];
    } else {
      const def =
        (providerConfigDefaults as Record<string, Record<string, unknown>>)[providerId] ?? {};
      const delta: Record<string, unknown> = {};
      for (const [field, val] of Object.entries(config as Record<string, unknown>)) {
        if (val !== def[field]) delta[field] = val;
      }
      if (Object.keys(delta).length > 0) {
        storedOverrides[providerId] = delta as ProviderCustomConfig;
      } else {
        delete storedOverrides[providerId];
      }
    }

    const serialized = JSON.stringify(providerConfigOverridesSchema.parse(storedOverrides));
    await db
      .insert(appSettings)
      .values({ key: 'providerConfigs', value: serialized })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: serialized } })
      .execute();

    delete this.cache['providerConfigs'];
  }

  async getAllSettings(): Promise<AppSettings> {
    const entries = await Promise.all(
      AppSettingsKeys.map(async (key) => [key, await this.getAppSettingsKey(key)] as const)
    );
    return Object.fromEntries(entries) as AppSettings;
  }

  async initialize(): Promise<void> {
    await this.getAllSettings();
  }
}

export const appSettingsService = new AppSettingsService();
