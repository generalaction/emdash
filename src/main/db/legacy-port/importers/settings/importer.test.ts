import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppSettings, AppSettingsKey } from '@shared/app-settings';
import { getDefaultForKey } from '@main/core/settings/settings-registry';
import { computeDelta, isDeepEqual, isPlainObject, mergeDeep } from '@main/core/settings/utils';
import { createDrizzleClient } from '../../../drizzleClient';
import { portLegacySettings } from './importer';

function createSettingsDb(): {
  appSqlite: Database.Database;
  appDb: ReturnType<typeof createDrizzleClient>['db'];
} {
  const appSqlite = new Database(':memory:');
  appSqlite.exec(`
    CREATE TABLE app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return {
    appSqlite,
    appDb: createDrizzleClient({ database: appSqlite }).db,
  };
}

function readRawSetting(appSqlite: Database.Database, key: string): unknown | null {
  const row = appSqlite.prepare('SELECT value FROM app_settings WHERE key = ? LIMIT 1').get(key) as
    | { value: string }
    | undefined;
  if (!row) return null;
  return JSON.parse(row.value) as unknown;
}

function upsertRawSetting(appSqlite: Database.Database, key: string, value: unknown): void {
  appSqlite
    .prepare(
      `
        INSERT INTO app_settings (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `
    )
    .run(key, JSON.stringify(value));
}

function deleteRawSetting(appSqlite: Database.Database, key: string): void {
  appSqlite.prepare('DELETE FROM app_settings WHERE key = ?').run(key);
}

function createSettingsStoreStub(appSqlite: Database.Database): {
  get<K extends AppSettingsKey>(key: K): Promise<AppSettings[K]>;
  update<K extends AppSettingsKey>(key: K, value: AppSettings[K]): Promise<void>;
} {
  return {
    async get<K extends AppSettingsKey>(key: K): Promise<AppSettings[K]> {
      const defaults = getDefaultForKey(key);
      const raw = readRawSetting(appSqlite, key);

      if (raw === null || raw === undefined) {
        return defaults;
      }

      if (isPlainObject(raw) && isPlainObject(defaults)) {
        return mergeDeep(defaults as Record<string, unknown>, raw) as AppSettings[K];
      }

      return raw as AppSettings[K];
    },
    async update<K extends AppSettingsKey>(key: K, value: AppSettings[K]): Promise<void> {
      const defaults = getDefaultForKey(key);

      if (isPlainObject(value) && isPlainObject(defaults)) {
        const delta = computeDelta(
          value as Record<string, unknown>,
          defaults as Record<string, unknown>
        );

        if (Object.keys(delta).length === 0) {
          deleteRawSetting(appSqlite, key);
        } else {
          upsertRawSetting(appSqlite, key, delta);
        }

        return;
      }

      if (isDeepEqual(value, defaults)) {
        deleteRawSetting(appSqlite, key);
        return;
      }

      upsertRawSetting(appSqlite, key, value);
    },
  };
}

describe('portLegacySettings', () => {
  const tempDirs: string[] = [];
  const openDbs: Database.Database[] = [];

  afterEach(() => {
    for (const db of openDbs.splice(0)) db.close();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ports only the approved mappings and preserves existing non-mapped settings', async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-settings-port-'));
    tempDirs.push(userDataDir);

    fs.writeFileSync(
      path.join(userDataDir, 'settings.json'),
      JSON.stringify({
        repository: { branchPrefix: 'legacy-prefix', pushOnCreate: false },
        projects: { defaultDirectory: '/legacy/projects' },
        tasks: {
          autoGenerateName: false,
          autoApproveByDefault: true,
          autoTrustWorktrees: false,
        },
        notifications: {
          enabled: false,
          sound: false,
          osNotifications: false,
          soundFocusMode: 'unfocused',
        },
        defaultProvider: 'codex',
        review: { prompt: '  Review this worktree carefully.  ' },
        interface: {
          autoRightSidebarBehavior: true,
          taskHoverAction: 'archive',
          theme: 'dark-black',
        },
        terminal: {
          fontFamily: '  Fira Code  ',
          autoCopyOnSelection: true,
        },
        browserPreview: { enabled: false },
        defaultOpenInApp: 'cursor',
        hiddenOpenInApps: ['terminal'],
        providerConfigs: {
          codex: { defaultArgs: '--dangerously-allow-all' },
        },
      }),
      'utf8'
    );

    const { appSqlite, appDb } = createSettingsDb();
    openDbs.push(appSqlite);

    appSqlite
      .prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)')
      .run('localProject', JSON.stringify({ defaultProjectsDirectory: '/beta/projects' }));
    appSqlite
      .prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)')
      .run('terminal', JSON.stringify({ autoCopyOnSelection: true }));
    appSqlite
      .prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)')
      .run(
        'interface',
        JSON.stringify({ autoRightSidebarBehavior: true, taskHoverAction: 'archive' })
      );
    appSqlite
      .prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)')
      .run('openIn', JSON.stringify({ default: 'cursor', hidden: ['terminal'] }));
    appSqlite
      .prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)')
      .run('providerConfigs', JSON.stringify({ codex: { defaultArgs: ['--legacy-arg'] } }));

    const summary = await portLegacySettings(userDataDir, {
      appDb,
      appSqlite,
      settingsStore: createSettingsStoreStub(appSqlite),
    });

    expect(summary.imported).toEqual([
      'localProject.branchPrefix',
      'localProject.pushOnCreate',
      'tasks.autoGenerateName',
      'tasks.autoApproveByDefault',
      'tasks.autoTrustWorktrees',
      'notifications.enabled',
      'notifications.sound',
      'notifications.osNotifications',
      'notifications.soundFocusMode',
      'defaultAgent',
      'reviewPrompt',
      'theme',
      'terminal.fontFamily',
    ]);

    const localProject = readRawSetting(appSqlite, 'localProject') as Record<string, unknown>;
    expect(localProject.defaultProjectsDirectory).toBe('/beta/projects');
    expect(localProject.branchPrefix).toBe('legacy-prefix');
    expect(localProject.pushOnCreate).toBe(false);

    expect(readRawSetting(appSqlite, 'tasks')).toEqual({
      autoGenerateName: false,
      autoApproveByDefault: true,
      autoTrustWorktrees: false,
    });
    expect(readRawSetting(appSqlite, 'notifications')).toEqual({
      enabled: false,
      sound: false,
      osNotifications: false,
      soundFocusMode: 'unfocused',
    });
    expect(readRawSetting(appSqlite, 'defaultAgent')).toBe('codex');
    expect(readRawSetting(appSqlite, 'reviewPrompt')).toBe('Review this worktree carefully.');
    expect(readRawSetting(appSqlite, 'theme')).toBe('emdark');

    const terminal = readRawSetting(appSqlite, 'terminal') as Record<string, unknown>;
    expect(terminal.autoCopyOnSelection).toBe(true);
    expect(terminal.fontFamily).toBe('Fira Code');

    // Non-mapped keys stay untouched.
    expect(readRawSetting(appSqlite, 'interface')).toEqual({
      autoRightSidebarBehavior: true,
      taskHoverAction: 'archive',
    });
    expect(readRawSetting(appSqlite, 'openIn')).toEqual({
      default: 'cursor',
      hidden: ['terminal'],
    });
    expect(readRawSetting(appSqlite, 'providerConfigs')).toEqual({
      codex: { defaultArgs: ['--legacy-arg'] },
    });
    expect(readRawSetting(appSqlite, 'browserPreview')).toBe(null);
  });

  it('skips when settings.json is missing or invalid', async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-settings-port-missing-'));
    tempDirs.push(userDataDir);

    const { appSqlite, appDb } = createSettingsDb();
    openDbs.push(appSqlite);

    const summary = await portLegacySettings(userDataDir, {
      appDb,
      appSqlite,
      settingsStore: createSettingsStoreStub(appSqlite),
    });
    expect(summary.imported).toEqual([]);
    expect(summary.skipped).toContain('settings:missing-or-invalid-json');
  });
});
