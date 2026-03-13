import { eq } from 'drizzle-orm';
import { AppSettingsKeys, type AppSettings, type AppSettingsKey } from '@shared/app-settings';
import { db } from '@main/db/client';
import { appSettings } from '@main/db/schema';
import { APP_SETTINGS_SCHEMA_MAP } from './schema';
import { getDefaultForKey } from './settings-registry';

export type { AppSettings, AppSettingsKey } from '@shared/app-settings';
export { AppSettingsKeys } from '@shared/app-settings';

// ---------------------------------------------------------------------------
// Delta helpers — exported for reuse by OverrideSettings.
// ---------------------------------------------------------------------------

function isDeepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function mergeDeep(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...base };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) continue;
    const baseVal = base[k];
    if (isPlainObject(v) && isPlainObject(baseVal)) {
      result[k] = mergeDeep(baseVal, v);
    } else {
      result[k] = v;
    }
  }
  return result;
}

export function computeDelta(
  value: Record<string, unknown>,
  defaults: Record<string, unknown>
): Record<string, unknown> {
  const delta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (!isDeepEqual(v, defaults[k])) {
      delta[k] = v;
    }
  }
  return delta;
}

// Returns only fields in `stored` that differ from `defaults`.
// Handles legacy rows that stored the full value — fields at their default
// value are excluded from the result (they are not "truly overridden").
export function computeTrueOverrides(
  stored: Record<string, unknown>,
  defaults: Record<string, unknown>
): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(stored)) {
    if (!isDeepEqual(v, defaults[k])) {
      overrides[k] = v;
    }
  }
  return overrides;
}

// ---------------------------------------------------------------------------
// Settings class — manages all fixed-key settings groups.
// ---------------------------------------------------------------------------

class Settings {
  private cache: Partial<AppSettings> = {};

  // Returns the raw parsed JSON value — may be a plain object (for group settings)
  // or a scalar (string for `theme` / `defaultAgent`).
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

  // Zod is NOT used on the read path — validation happens only on write.
  // Object settings are deep-merged with registry defaults; scalar settings
  // (theme, defaultAgent) are used directly.
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
    const defaults = getDefaultForKey(key);
    const raw = await this.readRaw(key);

    if (raw === null || raw === undefined) {
      return { value: defaults, defaults, overrides: {} as Partial<AppSettings[K]> };
    }

    let value: AppSettings[K];
    let overrides: Partial<AppSettings[K]>;

    if (isPlainObject(raw) && isPlainObject(defaults)) {
      value = mergeDeep(defaults as Record<string, unknown>, raw) as AppSettings[K];
      overrides = computeTrueOverrides(raw, defaults as Record<string, unknown>) as Partial<
        AppSettings[K]
      >;
    } else {
      // Scalar (theme, defaultAgent) — the whole value is the override if it differs
      value = raw as AppSettings[K];
      overrides = (isDeepEqual(raw, defaults) ? {} : raw) as Partial<AppSettings[K]>;
    }

    return { value, defaults, overrides };
  }

  // Zod validation is kept on the write path — ensures only valid data enters the DB.
  async update<K extends AppSettingsKey>(key: K, value: AppSettings[K]): Promise<void> {
    const validated = APP_SETTINGS_SCHEMA_MAP[key].parse(value) as AppSettings[K];
    const defaults = getDefaultForKey(key);

    if (isPlainObject(validated) && isPlainObject(defaults)) {
      const delta = computeDelta(
        validated as Record<string, unknown>,
        defaults as Record<string, unknown>
      );
      if (Object.keys(delta).length === 0) {
        await this.deleteRow(key);
      } else {
        await this.storeRaw(key, delta);
      }
    } else {
      // Scalar — delete row if value matches default, otherwise store
      if (isDeepEqual(validated, defaults)) {
        await this.deleteRow(key);
      } else {
        await this.storeRaw(key, validated);
      }
    }

    delete this.cache[key];
  }

  async reset<K extends AppSettingsKey>(key: K): Promise<void> {
    await this.deleteRow(key);
    delete this.cache[key];
  }

  async resetField<K extends AppSettingsKey>(key: K, field: keyof AppSettings[K]): Promise<void> {
    const raw = await this.readRaw(key);
    if (!isPlainObject(raw)) return; // no-op for scalar settings (theme, defaultAgent)

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

export const appSettingsService = new Settings();
