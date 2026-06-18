import { isDeepEqual } from '@emdash/shared';
import type { IInitializable } from '@emdash/shared';
import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { appSettings } from '@main/db/schema';
import { AppSettingsKeys, type AppSettings, type AppSettingsKey } from '@shared/core/app-settings';
import { APP_SETTINGS_SCHEMA_MAP } from './schema';
import {
  normalizeSettingValueForRead,
  normalizeSettingValueForStorage,
} from './settings-normalizers';
import { getDefaultForKey } from './settings-registry';
import { computeDelta, computeTrueOverrides, isPlainObject, mergeDeep } from './utils';

export type { AppSettings, AppSettingsKey } from '@shared/core/app-settings';
export { AppSettingsKeys } from '@shared/core/app-settings';

export class SettingsStore implements IInitializable {
  private cache: Partial<AppSettings> = {};

  private async readRaw(key: AppSettingsKey): Promise<unknown> {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).execute();
    if (!row) return null;
    try {
      return JSON.parse(row.value);
    } catch {
      return null;
    }
  }

  private async storeRaw(key: AppSettingsKey, value: unknown): Promise<void> {
    const serialized = JSON.stringify(value);
    await db
      .insert(appSettings)
      .values({ key, value: serialized })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: serialized } })
      .execute();
  }

  private async deleteRow(key: AppSettingsKey): Promise<void> {
    await db.delete(appSettings).where(eq(appSettings.key, key)).execute();
  }

  async get<K extends AppSettingsKey>(key: K): Promise<AppSettings[K]> {
    if (key in this.cache) return this.cache[key] as AppSettings[K];

    const defaults = getDefaultForKey(key);
    const raw = await this.readRaw(key);

    let value: AppSettings[K];
    if (raw === null || raw === undefined) {
      value = defaults;
    } else if (isPlainObject(raw) && isPlainObject(defaults)) {
      value = mergeDeep(defaults as Record<string, unknown>, raw) as AppSettings[K];
    } else {
      value = raw as AppSettings[K];
    }

    value = await normalizeSettingValueForRead(key, value, defaults);
    this.cache[key] = value;
    return value;
  }

  async getWithMeta<K extends AppSettingsKey>(
    key: K
  ): Promise<{
    value: AppSettings[K];
    defaults: AppSettings[K];
    overrides: Partial<AppSettings[K]>;
  }> {
    const rawDefaults = getDefaultForKey(key);
    const defaults = await normalizeSettingValueForRead(key, rawDefaults, rawDefaults);
    const raw = await this.readRaw(key);

    if (raw === null || raw === undefined) {
      return { value: defaults, defaults, overrides: {} as Partial<AppSettings[K]> };
    }

    let value: AppSettings[K];
    let overrides: Partial<AppSettings[K]>;

    if (isPlainObject(raw) && isPlainObject(rawDefaults)) {
      value = mergeDeep(rawDefaults as Record<string, unknown>, raw) as AppSettings[K];
    } else {
      value = raw as AppSettings[K];
    }

    value = await normalizeSettingValueForRead(key, value, rawDefaults);

    if (isPlainObject(value) && isPlainObject(defaults)) {
      overrides = computeTrueOverrides(
        value as Record<string, unknown>,
        defaults as Record<string, unknown>
      ) as Partial<AppSettings[K]>;
    } else {
      overrides = (isDeepEqual(value, defaults) ? {} : value) as Partial<AppSettings[K]>;
    }

    return { value, defaults, overrides };
  }

  async update<K extends AppSettingsKey>(key: K, value: AppSettings[K]): Promise<void> {
    const parsed = APP_SETTINGS_SCHEMA_MAP[key].parse(value) as AppSettings[K];
    const defaults = getDefaultForKey(key);
    const raw = await this.readRaw(key);
    const previousValue =
      isPlainObject(raw) && isPlainObject(defaults)
        ? (mergeDeep(defaults as Record<string, unknown>, raw) as AppSettings[K])
        : raw === null || raw === undefined
          ? defaults
          : (raw as AppSettings[K]);
    const [validated, normalizedDefaults] = await Promise.all([
      normalizeSettingValueForStorage(key, parsed, previousValue),
      normalizeSettingValueForRead(key, defaults, defaults),
    ]);

    if (isPlainObject(validated) && isPlainObject(defaults)) {
      const delta = computeDelta(
        validated as Record<string, unknown>,
        normalizedDefaults as Record<string, unknown>
      );
      if (Object.keys(delta).length === 0) {
        await this.deleteRow(key);
      } else {
        await this.storeRaw(key, delta);
      }
    } else if (isDeepEqual(validated, normalizedDefaults)) {
      await this.deleteRow(key);
    } else {
      await this.storeRaw(key, validated);
    }

    delete this.cache[key];
  }

  async reset<K extends AppSettingsKey>(key: K): Promise<void> {
    await this.deleteRow(key);
    delete this.cache[key];
  }

  async resetField<K extends AppSettingsKey>(key: K, field: keyof AppSettings[K]): Promise<void> {
    const raw = await this.readRaw(key);
    if (!isPlainObject(raw)) return;

    const delta = { ...raw };
    delete delta[field as string];

    if (Object.keys(delta).length === 0) {
      await this.deleteRow(key);
    } else {
      await this.storeRaw(key, delta);
    }
    delete this.cache[key];
  }

  async getAll(): Promise<AppSettings> {
    const entries = await Promise.all(
      AppSettingsKeys.map(async (key) => [key, await this.get(key)] as const)
    );
    return Object.fromEntries(entries) as AppSettings;
  }

  async initialize(): Promise<void> {
    await this.getAll();
  }
}

export const appSettingsService = new SettingsStore();
