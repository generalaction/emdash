import { eq } from 'drizzle-orm';
import { AppSettings, AppSettingsKey, AppSettingsKeys } from '@shared/app-settings';
import { db } from '@main/db/client';
import { appSettings } from '@main/db/schema';
import { APP_SETTINGS_SCHEMA_MAP, appSettingsSchema } from './schema';

class AppSettingsService {
  private cache: AppSettings | undefined;

  async initialize(): Promise<void> {
    await this.getAllSettings();
  }

  async getAllSettings(): Promise<AppSettings> {
    if (this.cache) return this.cache;
    const persistedSettings = await db.select().from(appSettings).execute();
    const keyedSettings = Object.fromEntries(
      persistedSettings.map((s) => [s.key, JSON.parse(s.value)])
    );
    const missingSettings = AppSettingsKeys.filter((key) => !keyedSettings[key]);

    const settings = {
      ...persistedSettings.reduce(
        (acc, curr) => {
          acc[curr.key] = JSON.parse(curr.value);
          return acc;
        },
        {} as Record<string, unknown>
      ),
      ...Object.fromEntries(
        missingSettings.map((key) => [
          key,
          APP_SETTINGS_SCHEMA_MAP[key as keyof AppSettings].parse(undefined),
        ])
      ),
    };
    const parsedSettings = appSettingsSchema.parse(settings);
    this.cache = parsedSettings;
    return parsedSettings;
  }

  async updateSettingsKey<T extends AppSettingsKey>(key: T, value: AppSettings[T]): Promise<void> {
    await db
      .update(appSettings)
      .set({
        value: JSON.stringify(APP_SETTINGS_SCHEMA_MAP[key].parse(value)),
      })
      .where(eq(appSettings.key, key))
      .execute();
    if (this.cache) {
      this.cache[key] = value;
    }
  }

  async getAppSettingsKey<T extends AppSettingsKey>(key: T): Promise<AppSettings[T]> {
    const settings = await this.getAllSettings();
    return settings[key] as AppSettings[T];
  }
}

export const appSettingsService = new AppSettingsService();
