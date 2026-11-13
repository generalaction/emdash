import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type * as HostApi from '@emdash/core/primitives/host/api';
import { openFixture, type FixtureDb } from '@tooling/utils/db';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as Exec from '@main/core/utils/exec';
import { log } from '@main/lib/logger';
import { runLegacyPort, type LegacyPortStateStore } from './service';

const fakes = vi.hoisted(() => ({
  tmux: vi.fn(async (_command: string, _args?: string[]) => ({ stdout: '', stderr: '' })),
  failImportAfterConversations: false,
}));

vi.mock('@main/core/utils/exec', async (importOriginal) => ({
  ...(await importOriginal<typeof Exec>()),
  runLocalCommand: (command: string, args?: string[]) => fakes.tmux(command, args),
}));

vi.mock('@emdash/core/primitives/host/api', async (importOriginal) => {
  const original = await importOriginal<typeof HostApi>();
  return {
    ...original,
    hostRefKey: (...args: Parameters<typeof original.hostRefKey>) => {
      if (fakes.failImportAfterConversations) throw new Error('simulated import failure');
      return original.hostRefKey(...args);
    },
  };
});

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
      base_ref TEXT,
      repository_workspace_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );

    CREATE UNIQUE INDEX idx_projects_repository_workspace_id ON projects(repository_workspace_id)
      WHERE repository_workspace_id IS NOT NULL AND deleted_at IS NULL;

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
      is_pinned INTEGER NOT NULL DEFAULT 0,
      workspace_id TEXT,
      type TEXT NOT NULL DEFAULT 'task',
      automation_run_id TEXT,
      deleted_at TEXT
    );

    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      kind TEXT,
      location TEXT,
      ssh_connection_id TEXT,
      parent_id TEXT,
      path TEXT,
      config TEXT,
      origin TEXT,
      observed_status TEXT,
      observed_git TEXT,
      last_create_outcome TEXT,
      last_removal_attempt TEXT,
      script_outcomes TEXT,
      runtime_overlay TEXT,
      last_activated_at INTEGER,
      observed_at INTEGER,
      deletion_tombstone TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      untracked_at TEXT
    );

    CREATE UNIQUE INDEX idx_workspaces_local_path ON workspaces(path)
      WHERE location = 'local' AND untracked_at IS NULL AND path IS NOT NULL;
    CREATE UNIQUE INDEX idx_workspaces_remote_path ON workspaces(ssh_connection_id, path)
      WHERE location = 'remote' AND untracked_at IS NULL AND path IS NOT NULL;

    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      provider TEXT,
      config TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_interacted_at TEXT,
      is_initial_conversation INTEGER,
      agent_status TEXT,
      agent_status_seen INTEGER DEFAULT 1
    );
  `);
  return db;
}

function createSearchIndex(db: Database.Database): void {
  db.exec(`
    INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES ('fts_version', '1', unixepoch());

    CREATE VIRTUAL TABLE search_index USING fts5(
      item_type,
      item_id UNINDEXED,
      project_id UNINDEXED,
      title,
      keywords,
      tokenize = 'unicode61 remove_diacritics 1'
    );

    INSERT INTO search_index(item_type, item_id, project_id, title, keywords)
    VALUES ('task', 'stale-task', 'stale-project', 'Stale task', 'stale');
  `);
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

    const importedTask = appDb
      .prepare(`SELECT workspace_id FROM tasks WHERE id = ?`)
      .get('legacy-task-1') as { workspace_id: string | null };
    expect(importedTask.workspace_id).toBeTruthy();

    const importedWorkspace = appDb
      .prepare(`SELECT kind, location, type, config FROM workspaces WHERE id = ?`)
      .get(importedTask.workspace_id) as {
      kind: string;
      location: string;
      type: string;
      config: string;
    };
    expect(importedWorkspace).toMatchObject({
      kind: 'worktree',
      location: 'local',
      type: 'local',
    });
    expect(JSON.parse(importedWorkspace.config)).toEqual({
      version: '2',
      git: { kind: 'use-branch', branchName: 'feature/legacy-1' },
      workspace: { kind: 'new-worktree' },
    });

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

  it('ports v0 when destination contains an FTS search index', async () => {
    const appDb = createAppDb();
    createSearchIndex(appDb);
    openDbs.push(appDb);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-port-fts-'));
    tempDirs.push(tmpDir);

    seedLegacyDb(path.join(tmpDir, 'emdash.db'));

    const stateStore = new InMemoryLegacyPortStateStore();

    await runLegacyPort(tmpDir, { appDb, stateStore });

    const projectsAfterImport = appDb.prepare(`SELECT COUNT(*) AS count FROM projects`).get() as {
      count: number;
    };
    const searchRowsAfterImport = appDb
      .prepare(`SELECT COUNT(*) AS count FROM search_index`)
      .get() as {
      count: number;
    };

    expect(await stateStore.getStatus()).toBe('completed');
    expect(projectsAfterImport.count).toBe(1);
    expect(searchRowsAfterImport.count).toBe(0);
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
        base_ref TEXT,
        repository_workspace_id TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT
      );
    `);
    appDb
      .prepare(`INSERT INTO projects (id, name, base_ref) VALUES (?, ?, ?)`)
      .run('existing-project', 'Existing Project', 'main');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-port-rollback-'));
    tempDirs.push(tmpDir);

    seedLegacyDb(path.join(tmpDir, 'emdash.db'));

    const stateStore = new InMemoryLegacyPortStateStore();

    await runLegacyPort(tmpDir, { appDb, stateStore });

    const projects = appDb.prepare(`SELECT id, name FROM projects ORDER BY id ASC`).all() as Array<{
      id: string;
      name: string;
    }>;

    expect(await stateStore.getStatus()).toBeNull();
    expect(projects).toEqual([
      {
        id: 'existing-project',
        name: 'Existing Project',
      },
    ]);
  });

  describe('with a legacy tmux session to rename', () => {
    const legacyPtyId = 'codex-chat-legacy-conv-1';
    const fixtures: FixtureDb[] = [];
    let tmuxCalls: Array<{ args: string[]; appInTransaction: boolean }>;

    async function prepareLegacyImport(
      prefix: string
    ): Promise<{ appDb: Database.Database; tmpDir: string }> {
      const fixture = await openFixture('empty');
      fixtures.push(fixture);
      const appDb = fixture.sqlite;
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
      tempDirs.push(tmpDir);
      seedLegacyDb(path.join(tmpDir, 'emdash.db'));
      fs.writeFileSync(
        path.join(tmpDir, 'pty-session-map.json'),
        JSON.stringify({ [legacyPtyId]: {} })
      );

      tmuxCalls = [];
      fakes.tmux.mockImplementation(async (_command, args = []) => {
        // A real tmux subprocess yields to the event loop, letting other main-process work run.
        await new Promise<void>((resolve) => setImmediate(resolve));
        tmuxCalls.push({ args, appInTransaction: appDb.inTransaction });
        if (args[0] === 'has-session' && args[2] !== `=emdash-${legacyPtyId}`) {
          throw new Error("can't find session");
        }
        return { stdout: '', stderr: '' };
      });
      return { appDb, tmpDir };
    }

    afterEach(() => {
      for (const fixture of fixtures.splice(0)) fixture.close();
      fakes.failImportAfterConversations = false;
      fakes.tmux.mockReset();
      vi.restoreAllMocks();
    });

    function writeUnrelatedKvRowSoon(appDb: Database.Database): Promise<void> {
      return new Promise((resolve) =>
        setImmediate(() => {
          appDb.prepare(`INSERT INTO kv (key, value) VALUES ('unrelated-write', 'kept')`).run();
          resolve();
        })
      );
    }

    it('renames tmux sessions only after the import has committed', async () => {
      const { appDb, tmpDir } = await prepareLegacyImport('legacy-port-tmux-');
      const stateStore = new InMemoryLegacyPortStateStore();

      await runLegacyPort(tmpDir, { appDb, stateStore });

      expect(await stateStore.getStatus()).toBe('completed');
      expect(tmuxCalls.map((call) => call.args[0])).toContain('rename-session');
      expect(tmuxCalls.filter((call) => call.appInTransaction)).toEqual([]);
    });

    it('keeps other main-process writes when the import rolls back', async () => {
      const { appDb, tmpDir } = await prepareLegacyImport('legacy-port-concurrent-write-');
      fakes.failImportAfterConversations = true;
      const stateStore = new InMemoryLegacyPortStateStore();

      const unrelatedWrite = writeUnrelatedKvRowSoon(appDb);
      await runLegacyPort(tmpDir, { appDb, stateStore });
      await unrelatedWrite;

      expect(await stateStore.getStatus()).toBeNull();
      expect(appDb.prepare(`SELECT COUNT(*) AS count FROM conversations`).get()).toEqual({
        count: 0,
      });
      expect(appDb.prepare(`SELECT value FROM kv WHERE key = 'unrelated-write'`).get()).toEqual({
        value: 'kept',
      });
      expect(tmuxCalls.map((call) => call.args[0])).not.toContain('rename-session');
    });

    it('rejects an import that overlaps one already running', async () => {
      const { appDb, tmpDir } = await prepareLegacyImport('legacy-port-overlap-');
      const warn = vi.spyOn(log, 'warn');
      const stateStore = new InMemoryLegacyPortStateStore();

      const results = await Promise.allSettled([
        runLegacyPort(tmpDir, { appDb, stateStore }),
        runLegacyPort(tmpDir, { appDb, stateStore }),
      ]);

      expect(warn.mock.calls.map(([message, context]) => [message, context])).toEqual([]);
      expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
      expect((results[1] as PromiseRejectedResult).reason).toMatchObject({
        message: 'A legacy import is already running',
      });
      expect(await stateStore.getStatus()).toBe('completed');
      expect(appDb.prepare(`SELECT COUNT(*) AS count FROM conversations`).get()).toEqual({
        count: 1,
      });
    });
  });
});
