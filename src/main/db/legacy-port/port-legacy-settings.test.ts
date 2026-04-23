import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { portLegacySettings } from './port-legacy-settings';

function createSettingsDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

function readRawSetting(db: Database.Database, key: string): unknown | null {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ? LIMIT 1').get(key) as
    | { value: string }
    | undefined;
  if (!row) return null;
  return JSON.parse(row.value) as unknown;
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

  it('ports only the approved mappings and preserves existing non-mapped settings', () => {
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

    const appDb = createSettingsDb();
    openDbs.push(appDb);

    appDb
      .prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)')
      .run('localProject', JSON.stringify({ defaultProjectsDirectory: '/beta/projects' }));
    appDb
      .prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)')
      .run('terminal', JSON.stringify({ autoCopyOnSelection: true }));
    appDb
      .prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)')
      .run(
        'interface',
        JSON.stringify({ autoRightSidebarBehavior: true, taskHoverAction: 'archive' })
      );
    appDb
      .prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)')
      .run('openIn', JSON.stringify({ default: 'cursor', hidden: ['terminal'] }));
    appDb
      .prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)')
      .run('providerConfigs', JSON.stringify({ codex: { defaultArgs: ['--legacy-arg'] } }));

    const summary = portLegacySettings(userDataDir, { appDb });

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

    const localProject = readRawSetting(appDb, 'localProject') as Record<string, unknown>;
    expect(localProject.defaultProjectsDirectory).toBe('/beta/projects');
    expect(localProject.branchPrefix).toBe('legacy-prefix');
    expect(localProject.pushOnCreate).toBe(false);

    expect(readRawSetting(appDb, 'tasks')).toEqual({
      autoGenerateName: false,
      autoApproveByDefault: true,
      autoTrustWorktrees: false,
    });
    expect(readRawSetting(appDb, 'notifications')).toEqual({
      enabled: false,
      sound: false,
      osNotifications: false,
      soundFocusMode: 'unfocused',
    });
    expect(readRawSetting(appDb, 'defaultAgent')).toBe('codex');
    expect(readRawSetting(appDb, 'reviewPrompt')).toBe('Review this worktree carefully.');
    expect(readRawSetting(appDb, 'theme')).toBe('emdark');

    const terminal = readRawSetting(appDb, 'terminal') as Record<string, unknown>;
    expect(terminal.autoCopyOnSelection).toBe(true);
    expect(terminal.fontFamily).toBe('Fira Code');

    // Non-mapped keys stay untouched.
    expect(readRawSetting(appDb, 'interface')).toEqual({
      autoRightSidebarBehavior: true,
      taskHoverAction: 'archive',
    });
    expect(readRawSetting(appDb, 'openIn')).toEqual({ default: 'cursor', hidden: ['terminal'] });
    expect(readRawSetting(appDb, 'providerConfigs')).toEqual({
      codex: { defaultArgs: ['--legacy-arg'] },
    });
    expect(readRawSetting(appDb, 'browserPreview')).toBe(null);
  });

  it('skips when settings.json is missing or invalid', () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-settings-port-missing-'));
    tempDirs.push(userDataDir);

    const appDb = createSettingsDb();
    openDbs.push(appDb);

    const summary = portLegacySettings(userDataDir, { appDb });
    expect(summary.imported).toEqual([]);
    expect(summary.skipped).toContain('settings:missing-or-invalid-json');
  });
});
