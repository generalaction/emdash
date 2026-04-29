import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { isValidProviderId } from '@shared/agent-provider-registry';
import type { AppSettings, AppSettingsKey } from '@shared/app-settings';
import { getDefaultForKey } from '@main/core/settings/settings-registry';
import { isPlainObject, mergeDeep } from '@main/core/settings/utils';
import { tableExists } from '../../sqlite-utils';
import type { RelationalImportDb } from '../relational/types';

const LEGACY_SETTINGS_FILE = 'settings.json';

export type LegacySettingsPortSummary = {
  imported: string[];
  skipped: string[];
};

export type PortLegacySettingsOptions = {
  appDb: RelationalImportDb;
  appSqlite: Database.Database;
  settingsStore?: {
    get<K extends AppSettingsKey>(key: K): Promise<AppSettings[K]>;
    update<K extends AppSettingsKey>(key: K, value: AppSettings[K]): Promise<void>;
  };
};

type LegacyTheme = 'light' | 'dark' | 'dark-black' | 'system';

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

async function updateObjectSetting<K extends AppSettingsKey>(
  settingsStore: NonNullable<PortLegacySettingsOptions['settingsStore']>,
  key: K,
  patch: Record<string, unknown>
): Promise<void> {
  if (Object.keys(patch).length === 0) return;

  const defaults = getDefaultForKey(key);
  if (!isPlainObject(defaults)) return;

  const currentValue = await settingsStore.get(key);
  const currentObject = isPlainObject(currentValue)
    ? (currentValue as Record<string, unknown>)
    : (defaults as Record<string, unknown>);
  const merged = mergeDeep(currentObject, patch);

  await settingsStore.update(key, merged as AppSettings[K]);
}

async function updateScalarSetting<K extends AppSettingsKey>(
  settingsStore: NonNullable<PortLegacySettingsOptions['settingsStore']>,
  key: K,
  nextValue: AppSettings[K]
): Promise<void> {
  await settingsStore.update(key, nextValue);
}

function mapLegacyTheme(theme: unknown): AppSettings['theme'] | undefined {
  const value = theme as LegacyTheme;
  if (value === 'light') return 'emlight';
  if (value === 'dark' || value === 'dark-black') return 'emdark';
  if (value === 'system') return null;
  return undefined;
}

export async function portLegacySettings(
  userDataPath: string,
  options: PortLegacySettingsOptions
): Promise<LegacySettingsPortSummary> {
  const { appSqlite } = options;

  const summary: LegacySettingsPortSummary = {
    imported: [],
    skipped: [],
  };

  if (!tableExists(appSqlite, 'app_settings')) {
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

  const settingsStore =
    options.settingsStore ??
    new (await import('@main/core/settings/settings-service')).SettingsStore();
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
        await updateObjectSetting(settingsStore, 'localProject', patch);
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
        await updateObjectSetting(settingsStore, 'tasks', patch);
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
        await updateObjectSetting(settingsStore, 'notifications', patch);
      } catch {
        summary.skipped.push('notifications:validation-failed');
      }
    }
  }

  if (legacyRaw.defaultProvider !== undefined) {
    if (isValidProviderId(legacyRaw.defaultProvider)) {
      try {
        await updateScalarSetting(settingsStore, 'defaultAgent', legacyRaw.defaultProvider);
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
        await updateScalarSetting(settingsStore, 'reviewPrompt', prompt);
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
        await updateScalarSetting(settingsStore, 'theme', mappedTheme);
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
        await updateObjectSetting(settingsStore, 'terminal', { fontFamily });
        summary.imported.push('terminal.fontFamily');
      } catch {
        summary.skipped.push('terminal:validation-failed');
      }
    }
  }

  return summary;
}
