import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runLegacyPort, type LegacyPortStateStore } from './service';

function createAppDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE ssh_connections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      host TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 22,
      username TEXT NOT NULL,
      auth_type TEXT NOT NULL DEFAULT 'agent',
      private_key_path TEXT,
      use_agent INTEGER NOT NULL DEFAULT 0,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      workspace_provider TEXT NOT NULL DEFAULT 'local',
      base_ref TEXT,
      ssh_connection_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      source_branch TEXT,
      task_branch TEXT,
      linked_issue TEXT,
      archived_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_interacted_at TEXT,
      status_changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      is_pinned INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      provider TEXT,
      config TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

function seedLegacyDb(legacyPath: string): void {
  const legacy = new Database(legacyPath);
  legacy.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT,
      path TEXT,
      base_ref TEXT,
      is_remote INTEGER,
      remote_path TEXT,
      ssh_connection_id TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      name TEXT,
      status TEXT,
      branch TEXT,
      archived_at TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      title TEXT,
      provider TEXT,
      created_at TEXT,
      updated_at TEXT
    );
  `);

  legacy
    .prepare(
      `INSERT INTO projects (id, name, path, base_ref, is_remote, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      'legacy-project-1',
      'Legacy Project',
      '/legacy/repo',
      'main',
      0,
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z'
    );

  legacy
    .prepare(
      `INSERT INTO tasks (id, project_id, name, status, branch, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      'legacy-task-1',
      'legacy-project-1',
      'Legacy Task',
      'completed',
      'feature/legacy-1',
      '2026-01-01T01:00:00.000Z'
    );

  legacy
    .prepare(`INSERT INTO conversations (id, task_id, title, provider) VALUES (?, ?, ?, ?)`)
    .run('legacy-conv-1', 'legacy-task-1', 'Legacy conversation', 'codex');

  legacy.close();
}

class InMemoryLegacyPortStateStore implements LegacyPortStateStore {
  private status: 'completed' | 'no-legacy-file' | null = null;

  async getStatus(): Promise<'completed' | 'no-legacy-file' | null> {
    return this.status;
  }

  async setStatus(status: 'completed' | 'no-legacy-file'): Promise<void> {
    this.status = status;
  }
}

describe('runLegacyPort', () => {
  const openDbs: Database.Database[] = [];
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const db of openDbs.splice(0)) db.close();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('marks no-legacy-file when emdash.db is missing', async () => {
    const appDb = createAppDb();
    openDbs.push(appDb);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-port-missing-'));
    tempDirs.push(tmpDir);

    const stateStore = new InMemoryLegacyPortStateStore();

    await runLegacyPort(tmpDir, { appDb, stateStore });

    expect(await stateStore.getStatus()).toBe('no-legacy-file');
  });

  it('ports once and is idempotent via state-store guard', async () => {
    const appDb = createAppDb();
    openDbs.push(appDb);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-port-once-'));
    tempDirs.push(tmpDir);

    const legacyPath = path.join(tmpDir, 'emdash.db');
    seedLegacyDb(legacyPath);

    const stateStore = new InMemoryLegacyPortStateStore();

    await runLegacyPort(tmpDir, { appDb, stateStore });
    expect(await stateStore.getStatus()).toBe('completed');

    const projectsAfterFirstRun = appDb.prepare(`SELECT COUNT(*) AS count FROM projects`).get() as {
      count: number;
    };
    const tasksAfterFirstRun = appDb.prepare(`SELECT COUNT(*) AS count FROM tasks`).get() as {
      count: number;
    };

    expect(projectsAfterFirstRun.count).toBe(1);
    expect(tasksAfterFirstRun.count).toBe(1);

    const legacy = new Database(legacyPath);
    legacy
      .prepare(
        `INSERT INTO projects (id, name, path, base_ref, is_remote, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'legacy-project-2',
        'Legacy Project 2',
        '/legacy/repo-2',
        'main',
        0,
        '2026-01-02T00:00:00.000Z',
        '2026-01-02T00:00:00.000Z'
      );
    legacy.close();

    await runLegacyPort(tmpDir, { appDb, stateStore });

    const projectsAfterSecondRun = appDb
      .prepare(`SELECT COUNT(*) AS count FROM projects`)
      .get() as {
      count: number;
    };
    expect(projectsAfterSecondRun.count).toBe(1);
  });

  it('rolls back destination changes when a fatal import error happens', async () => {
    const appDb = new Database(':memory:');
    openDbs.push(appDb);
    appDb.pragma('foreign_keys = ON');
    appDb.exec(`
      CREATE TABLE ssh_connections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        host TEXT NOT NULL,
        port INTEGER NOT NULL DEFAULT 22,
        username TEXT NOT NULL,
        auth_type TEXT NOT NULL DEFAULT 'agent',
        private_key_path TEXT,
        use_agent INTEGER NOT NULL DEFAULT 0,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        workspace_provider TEXT NOT NULL DEFAULT 'local',
        base_ref TEXT,
        ssh_connection_id TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    appDb
      .prepare(
        `INSERT INTO projects (id, name, path, workspace_provider, base_ref) VALUES (?, ?, ?, ?, ?)`
      )
      .run('existing-project', 'Existing Project', '/existing/repo', 'local', 'main');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-port-rollback-'));
    tempDirs.push(tmpDir);

    seedLegacyDb(path.join(tmpDir, 'emdash.db'));

    const stateStore = new InMemoryLegacyPortStateStore();

    await runLegacyPort(tmpDir, { appDb, stateStore });

    const projects = appDb
      .prepare(`SELECT id, name, path FROM projects ORDER BY id ASC`)
      .all() as Array<{ id: string; name: string; path: string }>;

    expect(await stateStore.getStatus()).toBeNull();
    expect(projects).toEqual([
      {
        id: 'existing-project',
        name: 'Existing Project',
        path: '/existing/repo',
      },
    ]);
  });
});
