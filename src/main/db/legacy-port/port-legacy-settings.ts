import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { isValidProviderId } from '@shared/agent-provider-registry';
import type { AppSettings, AppSettingsKey } from '@shared/app-settings';
import { APP_SETTINGS_SCHEMA_MAP } from '@main/core/settings/schema';
import { getDefaultForKey } from '@main/core/settings/settings-registry';
import { computeDelta, isDeepEqual, isPlainObject, mergeDeep } from '@main/core/settings/utils';

const LEGACY_SETTINGS_FILE = 'settings.json';

export type LegacySettingsPortSummary = {
  imported: string[];
  skipped: string[];
};

export type PortLegacySettingsOptions = {
  appDb: Database.Database;
};

type LegacyTheme = 'light' | 'dark' | 'dark-black' | 'system';

function hasTable(appDb: Database.Database, tableName: string): boolean {
  const row = appDb
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`)
    .get(tableName) as { 1: number } | undefined;
  return !!row;
}

function readJsonFile(filePath: string): unknown | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function readTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function readStoredSetting(appDb: Database.Database, key: AppSettingsKey): unknown | null {
  const row = appDb.prepare('SELECT value FROM app_settings WHERE key = ? LIMIT 1').get(key) as
    | { value: string }
    | undefined;
  if (!row) return null;

  try {
    return JSON.parse(row.value) as unknown;
  } catch {
    return null;
  }
}

function writeStoredSetting(appDb: Database.Database, key: AppSettingsKey, value: unknown): void {
  const serialized = JSON.stringify(value);
  appDb
    .prepare(
      `
      INSERT INTO app_settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `
    )
    .run(key, serialized);
}

function deleteStoredSetting(appDb: Database.Database, key: AppSettingsKey): void {
  appDb.prepare('DELETE FROM app_settings WHERE key = ?').run(key);
}

function persistSetting<K extends AppSettingsKey>(
  appDb: Database.Database,
  key: K,
  value: AppSettings[K]
): void {
  const defaults = getDefaultForKey(key);

  if (isPlainObject(value) && isPlainObject(defaults)) {
    const delta = computeDelta(
      value as Record<string, unknown>,
      defaults as Record<string, unknown>
    );
    if (Object.keys(delta).length === 0) {
      deleteStoredSetting(appDb, key);
      return;
    }

    writeStoredSetting(appDb, key, delta);
    return;
  }

  if (isDeepEqual(value, defaults)) {
    deleteStoredSetting(appDb, key);
    return;
  }

  writeStoredSetting(appDb, key, value);
}

function updateObjectSetting<K extends AppSettingsKey>(
  appDb: Database.Database,
  key: K,
  patch: Record<string, unknown>
): void {
  if (Object.keys(patch).length === 0) return;

  const defaults = getDefaultForKey(key);
  if (!isPlainObject(defaults)) return;

  const rawStored = readStoredSetting(appDb, key);
  const defaultsObject = defaults as Record<string, unknown>;
  const currentValue = isPlainObject(rawStored)
    ? mergeDeep(defaultsObject, rawStored)
    : mergeDeep({}, defaultsObject);
  const merged = mergeDeep(currentValue, patch);
  const validated = APP_SETTINGS_SCHEMA_MAP[key].parse(merged) as AppSettings[K];

  persistSetting(appDb, key, validated);
}

function updateScalarSetting<K extends AppSettingsKey>(
  appDb: Database.Database,
  key: K,
  nextValue: unknown
): void {
  const validated = APP_SETTINGS_SCHEMA_MAP[key].parse(nextValue) as AppSettings[K];
  persistSetting(appDb, key, validated);
}

function mapLegacyTheme(theme: unknown): AppSettings['theme'] | undefined {
  const value = theme as LegacyTheme;
  if (value === 'light') return 'emlight';
  if (value === 'dark' || value === 'dark-black') return 'emdark';
  if (value === 'system') return null;
  return undefined;
}

export function portLegacySettings(
  userDataPath: string,
  options: PortLegacySettingsOptions
): LegacySettingsPortSummary {
  const { appDb } = options;

  const summary: LegacySettingsPortSummary = {
    imported: [],
    skipped: [],
  };

  if (!hasTable(appDb, 'app_settings')) {
    summary.skipped.push('settings:app_settings-table-missing');
    return summary;
  }

  const settingsPath = join(userDataPath, LEGACY_SETTINGS_FILE);
  const legacyRaw = readJsonFile(settingsPath);
  if (legacyRaw === null) {
    summary.skipped.push('settings:missing-or-invalid-json');
    return summary;
  }

  if (!isPlainObject(legacyRaw)) {
    summary.skipped.push('settings:invalid-root');
    return summary;
  }

  const repository = isPlainObject(legacyRaw.repository) ? legacyRaw.repository : null;
  if (repository) {
    const patch: Record<string, unknown> = {};

    const branchPrefix = readTrimmedString(repository.branchPrefix);
    if (branchPrefix) {
      patch.branchPrefix = branchPrefix;
      summary.imported.push('localProject.branchPrefix');
    }

    const pushOnCreate = readBoolean(repository.pushOnCreate);
    if (pushOnCreate !== null) {
      patch.pushOnCreate = pushOnCreate;
      summary.imported.push('localProject.pushOnCreate');
    }

    if (Object.keys(patch).length > 0) {
      try {
        updateObjectSetting(appDb, 'localProject', patch);
      } catch {
        summary.skipped.push('localProject:validation-failed');
      }
    }
  }

  const tasks = isPlainObject(legacyRaw.tasks) ? legacyRaw.tasks : null;
  if (tasks) {
    const patch: Record<string, unknown> = {};
    const autoGenerateName = readBoolean(tasks.autoGenerateName);
    const autoApproveByDefault = readBoolean(tasks.autoApproveByDefault);
    const autoTrustWorktrees = readBoolean(tasks.autoTrustWorktrees);

    if (autoGenerateName !== null) {
      patch.autoGenerateName = autoGenerateName;
      summary.imported.push('tasks.autoGenerateName');
    }
    if (autoApproveByDefault !== null) {
      patch.autoApproveByDefault = autoApproveByDefault;
      summary.imported.push('tasks.autoApproveByDefault');
    }
    if (autoTrustWorktrees !== null) {
      patch.autoTrustWorktrees = autoTrustWorktrees;
      summary.imported.push('tasks.autoTrustWorktrees');
    }

    if (Object.keys(patch).length > 0) {
      try {
        updateObjectSetting(appDb, 'tasks', patch);
      } catch {
        summary.skipped.push('tasks:validation-failed');
      }
    }
  }

  const notifications = isPlainObject(legacyRaw.notifications) ? legacyRaw.notifications : null;
  if (notifications) {
    const patch: Record<string, unknown> = {};
    const enabled = readBoolean(notifications.enabled);
    const sound = readBoolean(notifications.sound);
    const osNotifications = readBoolean(notifications.osNotifications);
    const focusMode = notifications.soundFocusMode;

    if (enabled !== null) {
      patch.enabled = enabled;
      summary.imported.push('notifications.enabled');
    }
    if (sound !== null) {
      patch.sound = sound;
      summary.imported.push('notifications.sound');
    }
    if (osNotifications !== null) {
      patch.osNotifications = osNotifications;
      summary.imported.push('notifications.osNotifications');
    }
    if (focusMode === 'always' || focusMode === 'unfocused') {
      patch.soundFocusMode = focusMode;
      summary.imported.push('notifications.soundFocusMode');
    }

    if (Object.keys(patch).length > 0) {
      try {
        updateObjectSetting(appDb, 'notifications', patch);
      } catch {
        summary.skipped.push('notifications:validation-failed');
      }
    }
  }

  if (legacyRaw.defaultProvider !== undefined) {
    if (isValidProviderId(legacyRaw.defaultProvider)) {
      try {
        updateScalarSetting(appDb, 'defaultAgent', legacyRaw.defaultProvider);
        summary.imported.push('defaultAgent');
      } catch {
        summary.skipped.push('defaultAgent:validation-failed');
      }
    } else {
      summary.skipped.push('defaultAgent:invalid-provider');
    }
  }

  const review = isPlainObject(legacyRaw.review) ? legacyRaw.review : null;
  if (review) {
    const prompt = readTrimmedString(review.prompt);
    if (prompt) {
      try {
        updateScalarSetting(appDb, 'reviewPrompt', prompt);
        summary.imported.push('reviewPrompt');
      } catch {
        summary.skipped.push('reviewPrompt:validation-failed');
      }
    }
  }

  const interfaceSettings = isPlainObject(legacyRaw.interface) ? legacyRaw.interface : null;
  if (interfaceSettings) {
    const mappedTheme = mapLegacyTheme(interfaceSettings.theme);
    if (mappedTheme !== undefined) {
      try {
        updateScalarSetting(appDb, 'theme', mappedTheme);
        summary.imported.push('theme');
      } catch {
        summary.skipped.push('theme:validation-failed');
      }
    }
  }

  const terminal = isPlainObject(legacyRaw.terminal) ? legacyRaw.terminal : null;
  if (terminal) {
    const fontFamily = readTrimmedString(terminal.fontFamily);
    if (fontFamily) {
      try {
        updateObjectSetting(appDb, 'terminal', { fontFamily });
        summary.imported.push('terminal.fontFamily');
      } catch {
        summary.skipped.push('terminal:validation-failed');
      }
    }
  }

  return summary;
}
