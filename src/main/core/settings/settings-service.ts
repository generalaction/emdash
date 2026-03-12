import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path, { dirname, join } from 'node:path';
import { app } from 'electron';
import {
  AppSettings,
  AppSettingsUpdate,
  assertNoKeyboardShortcutConflicts,
  deepMerge,
  DEFAULT_SETTINGS,
  normalizeSettings,
  ProviderCustomConfig,
  ProviderCustomConfigs,
} from './utils';

export class SettingsService {
  private cached: AppSettings | null = null;

  getSettingsPath(): string {
    const dir = app.getPath('userData');
    return join(dir, 'settings.json');
  }

  getAppSettings(): AppSettings {
    try {
      if (this.cached) return this.cached;
      const file = this.getSettingsPath();
      if (existsSync(file)) {
        const raw = readFileSync(file, 'utf8');
        const parsed = JSON.parse(raw);
        this.cached = normalizeSettings(deepMerge(DEFAULT_SETTINGS, parsed));
        return this.cached;
      }
    } catch {
      // ignore read/parse errors, fall through to defaults
    }
    this.cached = { ...DEFAULT_SETTINGS };
    return this.cached;
  }

  updateAppSettings(partial: AppSettingsUpdate): AppSettings {
    const merged = deepMerge(this.getAppSettings(), partial as Partial<AppSettings>);
    const next = normalizeSettings(merged);
    if (partial.keyboard) {
      assertNoKeyboardShortcutConflicts(next.keyboard);
    }
    this.persistSettings(next);
    this.cached = next;
    return next;
  }

  getProviderCustomConfig(providerId: string): ProviderCustomConfig | undefined {
    const settings = this.getAppSettings();
    const config = settings.providerConfigs?.[providerId];
    return config ? { ...config } : undefined;
  }

  getAllProviderCustomConfigs(): ProviderCustomConfigs {
    const settings = this.getAppSettings();
    const configs = settings.providerConfigs ?? {};
    // Return deep copy to prevent cache corruption
    return Object.fromEntries(Object.entries(configs).map(([key, value]) => [key, { ...value }]));
  }

  updateProviderCustomConfig(providerId: string, config: ProviderCustomConfig | undefined): void {
    const settings = this.getAppSettings();
    const currentConfigs = settings.providerConfigs ?? {};

    if (config === undefined) {
      // Remove the config
      const { [providerId]: _, ...rest } = currentConfigs;
      this.updateAppSettings({ providerConfigs: rest });
    } else {
      // Update/add the config
      this.updateAppSettings({
        providerConfigs: {
          ...currentConfigs,
          [providerId]: config,
        },
      });
    }
  }

  getWorktreesDir(): string {
    return path.join(app.getPath('userData'), 'worktrees');
  }

  private persistSettings(settings: AppSettings) {
    try {
      const file = this.getSettingsPath();
      const dir = dirname(file);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(file, JSON.stringify(settings, null, 2), 'utf8');
    } catch {}
  }
}

export const settingsService = new SettingsService();
