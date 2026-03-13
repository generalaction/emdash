import { eq } from 'drizzle-orm';
import type { ZodType } from 'zod';
import { db } from '@main/db/client';
import { appSettings } from '@main/db/schema';
import { computeTrueOverrides, mergeDeep } from './settings-service';

/**
 * Manages dictionary-type settings where each item's defaults come from an
 * external registry (e.g. the agent provider registry).
 *
 * The DB stores a single JSON row whose value is a map of id → delta
 * (only fields differing from the external defaults are persisted).
 */
export class OverrideSettings<TConfig extends object> {
  private cache: Record<string, TConfig> | null = null;

  constructor(
    private readonly storageKey: string,
    private readonly getExternalDefaults: () => Record<string, TConfig>,
    private readonly itemSchema: ZodType<Partial<TConfig>>
  ) {}

  private async readRawOverrides(): Promise<Record<string, Partial<TConfig>>> {
    const [row] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, this.storageKey))
      .execute();
    if (!row) return {};
    try {
      return JSON.parse(row.value) as Record<string, Partial<TConfig>>;
    } catch {
      return {};
    }
  }

  private async storeOverrides(overrides: Record<string, Partial<TConfig>>): Promise<void> {
    if (Object.keys(overrides).length === 0) {
      await db.delete(appSettings).where(eq(appSettings.key, this.storageKey)).execute();
    } else {
      const serialized = JSON.stringify(overrides);
      await db
        .insert(appSettings)
        .values({ key: this.storageKey, value: serialized })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: serialized } })
        .execute();
    }
    this.cache = null;
  }

  /** Returns all items with external defaults merged with stored overrides. */
  async getAll(): Promise<Record<string, TConfig>> {
    if (this.cache) return this.cache;

    const externalDefaults = this.getExternalDefaults();
    const storedOverrides = await this.readRawOverrides();
    const result: Record<string, TConfig> = {};
    const allIds = new Set([...Object.keys(externalDefaults), ...Object.keys(storedOverrides)]);

    for (const id of allIds) {
      const def = (externalDefaults[id] ?? {}) as Record<string, unknown>;
      const override = (storedOverrides[id] ?? {}) as Record<string, unknown>;
      result[id] = mergeDeep(def, override) as TConfig;
    }

    this.cache = result;
    return result;
  }

  /** Returns the resolved config for a single item, or undefined if the id is unknown. */
  async getItem(id: string): Promise<TConfig | undefined> {
    const all = await this.getAll();
    return all[id];
  }

  /** Returns value + defaults + overrides for a single item — powers "is overridden?" UI. */
  async getItemWithMeta(id: string): Promise<{
    value: TConfig;
    defaults: TConfig;
    overrides: Partial<TConfig>;
  } | null> {
    const externalDefaults = this.getExternalDefaults();
    const defaults = externalDefaults[id];
    if (!defaults) return null;

    const storedOverrides = await this.readRawOverrides();
    const itemOverrides = (storedOverrides[id] ?? {}) as Record<string, unknown>;
    const trueOverrides = computeTrueOverrides(
      itemOverrides,
      defaults as Record<string, unknown>
    ) as Partial<TConfig>;
    const value = mergeDeep(defaults as Record<string, unknown>, itemOverrides) as TConfig;

    return { value, defaults, overrides: trueOverrides };
  }

  /** Persists only the fields of config that differ from the item's external defaults. */
  async updateItem(id: string, config: Partial<TConfig>): Promise<void> {
    const externalDefaults = this.getExternalDefaults();
    const defaults = (externalDefaults[id] ?? {}) as Record<string, unknown>;
    const validated = this.itemSchema.parse(config) as Record<string, unknown>;
    const delta = computeTrueOverrides(validated, defaults) as Partial<TConfig>;

    const storedOverrides = await this.readRawOverrides();
    if (Object.keys(delta).length === 0) {
      delete storedOverrides[id];
    } else {
      storedOverrides[id] = delta;
    }
    await this.storeOverrides(storedOverrides);
  }

  /** Removes all stored overrides for a single item, restoring it to external defaults. */
  async resetItem(id: string): Promise<void> {
    const storedOverrides = await this.readRawOverrides();
    delete storedOverrides[id];
    await this.storeOverrides(storedOverrides);
  }

  /** Removes all stored overrides for all items. */
  async resetAll(): Promise<void> {
    await db.delete(appSettings).where(eq(appSettings.key, this.storageKey)).execute();
    this.cache = null;
  }
}
