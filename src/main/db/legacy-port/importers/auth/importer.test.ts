import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createDrizzleClient } from '../../../drizzleClient';
import { portLegacyAuthState } from './importer';

function createAppDbWithConfigTables(): {
  appSqlite: Database.Database;
  appDb: ReturnType<typeof createDrizzleClient>['db'];
} {
  const appSqlite = new Database(':memory:');
  appSqlite.exec(`
    CREATE TABLE kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE app_secrets (
      key TEXT PRIMARY KEY,
      secret TEXT NOT NULL
    );
  `);
  return {
    appSqlite,
    appDb: createDrizzleClient({ database: appSqlite }).db,
  };
}

function readKv<T>(appSqlite: Database.Database, fullKey: string): T | null {
  const row = appSqlite.prepare('SELECT value FROM kv WHERE key = ?').get(fullKey) as
    | { value: string }
    | undefined;
  if (!row) return null;
  return JSON.parse(row.value) as T;
}

function readSecret(appSqlite: Database.Database, key: string): string | null {
  const row = appSqlite.prepare('SELECT secret FROM app_secrets WHERE key = ?').get(key) as
    | { secret: string }
    | undefined;
  return row?.secret ?? null;
}

describe('portLegacyAuthState', () => {
  const tempDirs: string[] = [];
  const openDbs: Database.Database[] = [];

  afterEach(() => {
    for (const db of openDbs.splice(0)) db.close();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ports keychain secrets + legacy JSON files into app_secrets and kv', async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-auth-port-'));
    tempDirs.push(userDataDir);

    fs.writeFileSync(
      path.join(userDataDir, 'jira.json'),
      JSON.stringify({ siteUrl: 'https://jira.example.com', email: 'me@example.com' }),
      'utf8'
    );
    fs.writeFileSync(
      path.join(userDataDir, 'forgejo.json'),
      JSON.stringify({ siteUrl: 'https://forgejo.example.com/' }),
      'utf8'
    );
    fs.writeFileSync(
      path.join(userDataDir, 'gitlab.json'),
      JSON.stringify({ siteUrl: 'https://gitlab.example.com/' }),
      'utf8'
    );
    fs.writeFileSync(
      path.join(userDataDir, 'emdash-account.json'),
      JSON.stringify({
        hasAccount: true,
        userId: 'user-1',
        username: 'jona',
        avatarUrl: 'https://example.com/avatar.png',
        email: 'jona@example.com',
        lastValidated: '2026-04-23T12:00:00.000Z',
      }),
      'utf8'
    );

    const secretMap = new Map<string, string>([
      ['emdash-github:github-token', 'gh_123'],
      ['emdash-linear:api-token', 'lin_123'],
      ['emdash-jira:api-token', 'jira_123'],
      ['emdash-plain:api-token', 'plain_123'],
      ['emdash-forgejo:forgejo-token', 'forgejo_123'],
      ['emdash-gitlab:gitlab-token', 'gitlab_123'],
      ['emdash-account:session-token', 'session_123'],
      ['emdash-ssh:legacy-ssh-1:password', 'ssh_pwd_123'],
    ]);

    const { appSqlite, appDb } = createAppDbWithConfigTables();
    openDbs.push(appSqlite);

    const summary = await portLegacyAuthState(userDataDir, {
      appDb,
      appSqlite,
      readLegacySecret: async (service, account) => secretMap.get(`${service}:${account}`) ?? null,
      encryptSecret: (secret) => Buffer.from(`enc:${secret}`, 'utf8').toString('base64'),
      legacyToAppSshConnectionId: new Map([['legacy-ssh-1', 'ssh-app-1']]),
    });

    expect(summary.importedSecrets).toEqual([
      'github',
      'linear',
      'jira',
      'plain',
      'forgejo',
      'gitlab',
      'account',
    ]);
    expect(summary.importedSshPasswords).toBe(1);

    expect(readSecret(appSqlite, 'emdash-github-token')).toBe(
      Buffer.from('enc:gh_123', 'utf8').toString('base64')
    );
    expect(readSecret(appSqlite, 'emdash-account-token')).toBe(
      Buffer.from('enc:session_123', 'utf8').toString('base64')
    );
    expect(readSecret(appSqlite, 'ssh:ssh-app-1:password')).toBe(
      Buffer.from('enc:ssh_pwd_123', 'utf8').toString('base64')
    );

    expect(readKv<string>(appSqlite, 'github:tokenSource')).toBe('secure_storage');
    expect(readKv<{ siteUrl: string; email: string }>(appSqlite, 'jira:creds')).toEqual({
      siteUrl: 'https://jira.example.com',
      email: 'me@example.com',
    });
    expect(readKv<{ instanceUrl: string }>(appSqlite, 'forgejo:connection')).toEqual({
      instanceUrl: 'https://forgejo.example.com',
    });
    expect(readKv<{ instanceUrl: string }>(appSqlite, 'gitlab:connection')).toEqual({
      instanceUrl: 'https://gitlab.example.com',
    });
    expect(
      readKv<{ userId: string; username: string }>(appSqlite, 'account:profile')
    ).toMatchObject({
      userId: 'user-1',
      username: 'jona',
    });
  });

  it('skips malformed legacy config without throwing', async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-auth-port-invalid-'));
    tempDirs.push(userDataDir);

    fs.writeFileSync(path.join(userDataDir, 'jira.json'), '{bad-json', 'utf8');
    fs.writeFileSync(
      path.join(userDataDir, 'emdash-account.json'),
      JSON.stringify({ hasAccount: true, userId: '', username: '' }),
      'utf8'
    );

    const { appSqlite, appDb } = createAppDbWithConfigTables();
    openDbs.push(appSqlite);

    const summary = await portLegacyAuthState(userDataDir, {
      appDb,
      appSqlite,
      readLegacySecret: async () => null,
      encryptSecret: (secret) => Buffer.from(secret, 'utf8').toString('base64'),
      legacyToAppSshConnectionId: new Map([['legacy-ssh-1', 'ssh-app-1']]),
    });

    expect(summary.importedSecrets).toEqual([]);
    expect(summary.importedKv).toEqual([]);
    expect(summary.importedSshPasswords).toBe(0);
    expect(summary.skipped.length).toBeGreaterThan(0);

    const secretCount = (
      appSqlite.prepare('SELECT COUNT(*) AS count FROM app_secrets').get() as {
        count: number;
      }
    ).count;
    const kvCount = (
      appSqlite.prepare('SELECT COUNT(*) AS count FROM kv').get() as { count: number }
    ).count;

    expect(secretCount).toBe(0);
    expect(kvCount).toBe(0);
  });

  it('does not overwrite an existing app ssh password on dedup remap', async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-auth-port-ssh-dedup-'));
    tempDirs.push(userDataDir);

    const { appSqlite, appDb } = createAppDbWithConfigTables();
    openDbs.push(appSqlite);

    appSqlite
      .prepare('INSERT INTO app_secrets (key, secret) VALUES (?, ?)')
      .run('ssh:ssh-app-1:password', Buffer.from('enc:existing_pwd', 'utf8').toString('base64'));

    const secretMap = new Map<string, string>([['emdash-ssh:legacy-ssh-1:password', 'legacy_pwd']]);

    const summary = await portLegacyAuthState(userDataDir, {
      appDb,
      appSqlite,
      readLegacySecret: async (service, account) => secretMap.get(`${service}:${account}`) ?? null,
      encryptSecret: (secret) => Buffer.from(`enc:${secret}`, 'utf8').toString('base64'),
      legacyToAppSshConnectionId: new Map([['legacy-ssh-1', 'ssh-app-1']]),
    });

    expect(summary.importedSshPasswords).toBe(0);
    expect(summary.skipped).toContain('ssh.password:ssh-app-1:already-present');
    expect(readSecret(appSqlite, 'ssh:ssh-app-1:password')).toBe(
      Buffer.from('enc:existing_pwd', 'utf8').toString('base64')
    );
  });
});
