import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createRemapTables } from '../remap';
import { portConversations } from './conversations';
import { portProjects } from './projects';
import { portSshConnections } from './ssh-connections';
import { portTasks } from './tasks';

function createAppDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
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

function createLegacyDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE ssh_connections (
      id TEXT PRIMARY KEY,
      name TEXT,
      host TEXT,
      port INTEGER,
      username TEXT,
      auth_type TEXT,
      private_key_path TEXT,
      use_agent INTEGER,
      created_at TEXT,
      updated_at TEXT
    );

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
  return db;
}

describe('legacy-port table passes', () => {
  const openDbs: Database.Database[] = [];

  afterEach(() => {
    for (const db of openDbs.splice(0)) db.close();
  });

  it('ports with dedup + remap and skips merged-task conversations', () => {
    const appDb = createAppDb();
    const legacyDb = createLegacyDb();
    openDbs.push(appDb, legacyDb);

    appDb
      .prepare(
        `INSERT INTO ssh_connections (id, name, host, port, username) VALUES (?, ?, ?, ?, ?)`
      )
      .run('ssh-beta', 'prod', 'example.com', 22, 'alice');

    appDb
      .prepare(
        `INSERT INTO projects (id, name, path, workspace_provider, base_ref) VALUES (?, ?, ?, ?, ?)`
      )
      .run('proj-beta-local', 'Beta Local', '/work/repo', 'local', 'main');

    appDb
      .prepare(
        `INSERT INTO tasks (id, project_id, name, status, source_branch, task_branch) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        'task-beta-existing',
        'proj-beta-local',
        'Existing Task',
        'todo',
        JSON.stringify({ type: 'local', branch: 'main' }),
        'feature/shared'
      );

    legacyDb
      .prepare(
        `INSERT INTO ssh_connections (id, name, host, port, username, auth_type, use_agent) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run('ssh-legacy-1', 'legacy-prod', 'EXAMPLE.com', 22, 'alice', 'agent', 1);

    legacyDb
      .prepare(
        `INSERT INTO projects (id, name, path, base_ref, is_remote, remote_path, ssh_connection_id) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run('proj-legacy-local', 'Legacy Local', '/work/repo', 'main', 0, null, null);

    legacyDb
      .prepare(
        `INSERT INTO projects (id, name, path, base_ref, is_remote, remote_path, ssh_connection_id) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run('proj-legacy-ssh', 'Legacy SSH', '/ignored', 'main', 1, '/srv/repo', 'ssh-legacy-1');

    legacyDb
      .prepare(
        `INSERT INTO projects (id, name, path, base_ref, is_remote, remote_path, ssh_connection_id) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'proj-legacy-invalid-ssh',
        'Legacy Invalid SSH',
        '/ignored2',
        'main',
        1,
        '   ',
        'ssh-legacy-1'
      );

    legacyDb
      .prepare(
        `INSERT INTO tasks (id, project_id, name, status, branch, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        'task-legacy-merged',
        'proj-legacy-local',
        'Legacy Merged Task',
        'idle',
        'feature/shared',
        '2026-01-01T12:00:00.000Z'
      );

    legacyDb
      .prepare(
        `INSERT INTO tasks (id, project_id, name, status, branch, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        'task-legacy-new',
        'proj-legacy-ssh',
        'Legacy New Task',
        'running',
        'feature/new-legacy',
        '2026-01-02T12:00:00.000Z'
      );

    legacyDb
      .prepare(`INSERT INTO conversations (id, task_id, title, provider) VALUES (?, ?, ?, ?)`)
      .run('conv-legacy-merged', 'task-legacy-merged', 'Merged conversation', 'codex');

    legacyDb
      .prepare(`INSERT INTO conversations (id, task_id, title, provider) VALUES (?, ?, ?, ?)`)
      .run('conv-legacy-new', 'task-legacy-new', 'New conversation', 'codex');

    const remap = createRemapTables();
    const sshSummary = portSshConnections({ appDb, legacyDb, remap });
    const projectsSummary = portProjects({ appDb, legacyDb, remap });
    const taskResult = portTasks({ appDb, legacyDb, remap });
    const conversationsSummary = portConversations({
      appDb,
      legacyDb,
      remap,
      mergedLegacyTaskIds: taskResult.mergedLegacyTaskIds,
    });

    expect(sshSummary.considered).toBe(1);
    expect(sshSummary.skippedDedup).toBe(1);
    expect(remap.sshConnectionId.get('ssh-legacy-1')).toBe('ssh-beta');

    expect(projectsSummary.considered).toBe(3);
    expect(projectsSummary.skippedDedup).toBe(1);
    expect(projectsSummary.skippedInvalid).toBe(1);
    expect(remap.projectId.get('proj-legacy-local')).toBe('proj-beta-local');

    const mappedSshProjectId = remap.projectId.get('proj-legacy-ssh');
    expect(mappedSshProjectId).toBeTruthy();

    expect(taskResult.summary.considered).toBe(2);
    expect(taskResult.summary.skippedDedup).toBe(1);
    expect(remap.taskId.get('task-legacy-merged')).toBe('task-beta-existing');
    expect(taskResult.mergedLegacyTaskIds.has('task-legacy-merged')).toBe(true);

    const insertedTaskId = remap.taskId.get('task-legacy-new');
    expect(insertedTaskId).toBeTruthy();

    const insertedTask = appDb
      .prepare(
        `SELECT project_id, status, source_branch, task_branch, status_changed_at, last_interacted_at, is_pinned FROM tasks WHERE id = ?`
      )
      .get(insertedTaskId) as {
      project_id: string;
      status: string;
      source_branch: string | null;
      task_branch: string;
      status_changed_at: string | null;
      last_interacted_at: string | null;
      is_pinned: number;
    };

    expect(insertedTask.project_id).toBe(mappedSshProjectId);
    expect(insertedTask.status).toBe('in_progress');
    expect(insertedTask.source_branch).toBeNull();
    expect(insertedTask.task_branch).toBe('feature/new-legacy');
    expect(insertedTask.status_changed_at).toBe('2026-01-02T12:00:00.000Z');
    expect(insertedTask.last_interacted_at).toBe('2026-01-02T12:00:00.000Z');
    expect(insertedTask.is_pinned).toBe(0);

    expect(conversationsSummary.considered).toBe(2);
    expect(conversationsSummary.skippedDedup).toBe(1);

    const conversations = appDb
      .prepare(`SELECT id, task_id, project_id, title FROM conversations ORDER BY id ASC`)
      .all() as Array<{ id: string; task_id: string; project_id: string; title: string }>;

    expect(conversations).toEqual([
      {
        id: 'conv-legacy-new',
        task_id: insertedTaskId!,
        project_id: mappedSshProjectId!,
        title: 'New conversation',
      },
    ]);
  });
});
