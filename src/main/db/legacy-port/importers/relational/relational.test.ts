import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { makePtySessionId } from '@shared/ptySessionId';
import { makeTmuxSessionName } from '@main/core/pty/tmux-session-name';
import { createDrizzleClient } from '../../../drizzleClient';
import { portConversations } from './conversations';
import { portProjects } from './projects';
import { createRemapTables } from './remap';
import { portSshConnections } from './ssh-connections';
import { portTasks } from './tasks';

function createAppDb(): {
  appSqlite: Database.Database;
  appDb: ReturnType<typeof createDrizzleClient>['db'];
} {
  const appSqlite = new Database(':memory:');
  appSqlite.pragma('foreign_keys = ON');
  appSqlite.exec(`
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
      is_pinned INTEGER NOT NULL DEFAULT 0,
      workspace_provider TEXT,
      workspace_id TEXT,
      workspace_provider_data TEXT
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

  return {
    appSqlite,
    appDb: createDrizzleClient({ database: appSqlite }).db,
  };
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
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const db of openDbs.splice(0)) db.close();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ports with dedup + remap and skips merged-task conversations', async () => {
    const { appSqlite, appDb } = createAppDb();
    const legacyDb = createLegacyDb();
    openDbs.push(appSqlite, legacyDb);

    appSqlite
      .prepare(
        `INSERT INTO ssh_connections (id, name, host, port, username) VALUES (?, ?, ?, ?, ?)`
      )
      .run('ssh-beta', 'prod', 'example.com', 22, 'alice');

    appSqlite
      .prepare(
        `INSERT INTO projects (id, name, path, workspace_provider, base_ref) VALUES (?, ?, ?, ?, ?)`
      )
      .run('proj-beta-local', 'Beta Local', '/work/repo', 'local', 'main');

    appSqlite
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
    const sshSummary = await portSshConnections({ appDb, legacyDb, remap });
    const projectsSummary = await portProjects({ appDb, legacyDb, remap });
    const taskResult = await portTasks({ appDb, legacyDb, remap });
    const conversationsSummary = await portConversations({
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

    const insertedTask = appSqlite
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

    const conversations = appSqlite
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

  it('imports direct legacy tasks as source-branch-only when use_worktree is false', async () => {
    const { appSqlite, appDb } = createAppDb();
    const legacyDb = createLegacyDb();
    openDbs.push(appSqlite, legacyDb);

    legacyDb.exec(`
      ALTER TABLE tasks ADD COLUMN path TEXT;
      ALTER TABLE tasks ADD COLUMN use_worktree INTEGER;
    `);

    legacyDb
      .prepare(
        `INSERT INTO projects (id, name, path, base_ref, is_remote, remote_path, ssh_connection_id) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run('proj-legacy-local', 'Legacy Local', '/work/repo', 'main', 0, null, null);

    const remap = createRemapTables();
    const projectsSummary = await portProjects({ appDb, legacyDb, remap });
    expect(projectsSummary.inserted).toBe(1);

    legacyDb
      .prepare(
        `INSERT INTO tasks (id, project_id, name, status, branch, path, use_worktree, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'task-legacy-direct',
        'proj-legacy-local',
        'Legacy Direct Task',
        'idle',
        'main',
        '/work/repo',
        0,
        '2026-01-04T12:00:00.000Z'
      );

    legacyDb
      .prepare(
        `INSERT INTO tasks (id, project_id, name, status, branch, path, use_worktree, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'task-legacy-worktree',
        'proj-legacy-local',
        'Legacy Worktree Task',
        'running',
        'feature/worktree',
        '/work/worktrees/feature-worktree',
        1,
        '2026-01-05T12:00:00.000Z'
      );

    const taskResult = await portTasks({ appDb, legacyDb, remap });
    expect(taskResult.summary.inserted).toBe(2);

    const insertedTasks = appSqlite
      .prepare(
        `SELECT id, source_branch, task_branch FROM tasks WHERE id IN (?, ?) ORDER BY id ASC`
      )
      .all('task-legacy-direct', 'task-legacy-worktree') as Array<{
      id: string;
      source_branch: string | null;
      task_branch: string | null;
    }>;

    expect(insertedTasks).toEqual([
      {
        id: 'task-legacy-direct',
        source_branch: JSON.stringify({ type: 'local', branch: 'main' }),
        task_branch: null,
      },
      {
        id: 'task-legacy-worktree',
        source_branch: null,
        task_branch: 'feature/worktree',
      },
    ]);
  });

  it('falls back to comparing task path with project path when use_worktree is missing', async () => {
    const { appSqlite, appDb } = createAppDb();
    const legacyDb = createLegacyDb();
    openDbs.push(appSqlite, legacyDb);

    legacyDb.exec(`ALTER TABLE tasks ADD COLUMN path TEXT;`);

    legacyDb
      .prepare(
        `INSERT INTO projects (id, name, path, base_ref, is_remote, remote_path, ssh_connection_id) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run('proj-legacy-local', 'Legacy Local', '/work/repo', 'main', 0, null, null);

    const remap = createRemapTables();
    const projectsSummary = await portProjects({ appDb, legacyDb, remap });
    expect(projectsSummary.inserted).toBe(1);

    legacyDb
      .prepare(
        `INSERT INTO tasks (id, project_id, name, status, branch, path, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'task-legacy-direct',
        'proj-legacy-local',
        'Legacy Direct Task',
        'idle',
        'develop',
        '/work/repo',
        '2026-01-06T12:00:00.000Z'
      );

    legacyDb
      .prepare(
        `INSERT INTO tasks (id, project_id, name, status, branch, path, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'task-legacy-worktree',
        'proj-legacy-local',
        'Legacy Worktree Task',
        'running',
        'feature/fallback-worktree',
        '/work/worktrees/feature-fallback-worktree',
        '2026-01-07T12:00:00.000Z'
      );

    const taskResult = await portTasks({ appDb, legacyDb, remap });
    expect(taskResult.summary.inserted).toBe(2);

    const insertedTasks = appSqlite
      .prepare(
        `SELECT id, source_branch, task_branch FROM tasks WHERE id IN (?, ?) ORDER BY id ASC`
      )
      .all('task-legacy-direct', 'task-legacy-worktree') as Array<{
      id: string;
      source_branch: string | null;
      task_branch: string | null;
    }>;

    expect(insertedTasks).toEqual([
      {
        id: 'task-legacy-direct',
        source_branch: JSON.stringify({ type: 'local', branch: 'develop' }),
        task_branch: null,
      },
      {
        id: 'task-legacy-worktree',
        source_branch: null,
        task_branch: 'feature/fallback-worktree',
      },
    ]);
  });

  it('uses claude legacy resume uuid from pty-session-map and falls back to legacy id', async () => {
    const { appSqlite, appDb } = createAppDb();
    const legacyDb = createLegacyDb();
    openDbs.push(appSqlite, legacyDb);

    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-port-conv-'));
    tempDirs.push(userDataDir);

    const mappedChatUuid = '6ba95736-36d7-401e-9ef6-01655fb9162a';
    const mappedMainUuid = '08973564-c91f-4de8-a4df-a8f31e84c95f';
    const collisionUuid = '7f27294f-b8bf-4d9e-b8ac-c6f3f8575970';
    const mappedOptimisticUuid = '1a834cde-bb43-41e6-bdcf-f955a498ce96';

    fs.writeFileSync(
      path.join(userDataDir, 'pty-session-map.json'),
      JSON.stringify({
        'claude-chat-conv-legacy-chat': { uuid: mappedChatUuid },
        'claude-main-task-legacy-main': { uuid: mappedMainUuid },
        'claude-main-optimistic-1776065416593': { uuid: mappedOptimisticUuid },
        'claude-chat-conv-legacy-invalid': { uuid: 'not-a-uuid' },
        'claude-chat-conv-legacy-collision': { uuid: collisionUuid },
      }),
      'utf8'
    );

    appSqlite
      .prepare(
        `INSERT INTO projects (id, name, path, workspace_provider, base_ref) VALUES (?, ?, ?, ?, ?)`
      )
      .run('proj-existing', 'Existing Project', '/existing/repo', 'local', 'main');
    appSqlite
      .prepare(
        `INSERT INTO tasks (id, project_id, name, status, source_branch, task_branch) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        'task-existing',
        'proj-existing',
        'Existing Task',
        'todo',
        JSON.stringify({ type: 'local', branch: 'main' }),
        'feature/existing'
      );
    appSqlite
      .prepare(
        `INSERT INTO conversations (id, project_id, task_id, title, provider) VALUES (?, ?, ?, ?, ?)`
      )
      .run(collisionUuid, 'proj-existing', 'task-existing', 'Existing Conversation', 'claude');

    legacyDb
      .prepare(
        `INSERT INTO projects (id, name, path, base_ref, is_remote, remote_path, ssh_connection_id) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run('proj-legacy-claude', 'Legacy Claude', '/legacy/repo', 'main', 0, null, null);

    legacyDb
      .prepare(
        `INSERT INTO tasks (id, project_id, name, status, branch, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        'task-legacy-chat',
        'proj-legacy-claude',
        'Legacy Task Chat',
        'running',
        'feature/legacy-chat',
        '2026-01-03T12:00:00.000Z'
      );
    legacyDb
      .prepare(
        `INSERT INTO tasks (id, project_id, name, status, branch, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        'task-legacy-main',
        'proj-legacy-claude',
        'Legacy Task Main',
        'running',
        'feature/legacy-main',
        '2026-01-03T12:00:00.000Z'
      );
    legacyDb
      .prepare(
        `INSERT INTO tasks (id, project_id, name, status, branch, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        'task-legacy-invalid',
        'proj-legacy-claude',
        'Legacy Task Invalid',
        'running',
        'feature/legacy-invalid',
        '2026-01-03T12:00:00.000Z'
      );
    legacyDb
      .prepare(
        `INSERT INTO tasks (id, project_id, name, status, branch, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        'task-legacy-collision',
        'proj-legacy-claude',
        'Legacy Task Collision',
        'running',
        'feature/legacy-collision',
        '2026-01-03T12:00:00.000Z'
      );
    legacyDb
      .prepare(
        `INSERT INTO tasks (id, project_id, name, status, branch, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        'task-legacy-wt',
        'proj-legacy-claude',
        'Legacy Task WT',
        'running',
        'feature/legacy-wt',
        '2026-01-03T12:00:00.000Z'
      );

    legacyDb
      .prepare(`INSERT INTO conversations (id, task_id, title, provider) VALUES (?, ?, ?, ?)`)
      .run('conv-legacy-chat', 'task-legacy-chat', 'Legacy Claude Chat', 'claude');
    legacyDb
      .prepare(`INSERT INTO conversations (id, task_id, title, provider) VALUES (?, ?, ?, ?)`)
      .run('conv-legacy-main', 'task-legacy-main', 'Legacy Claude Main', 'claude');
    legacyDb
      .prepare(`INSERT INTO conversations (id, task_id, title, provider) VALUES (?, ?, ?, ?)`)
      .run('conv-legacy-invalid', 'task-legacy-invalid', 'Legacy Claude Invalid', 'claude');
    legacyDb
      .prepare(`INSERT INTO conversations (id, task_id, title, provider) VALUES (?, ?, ?, ?)`)
      .run('conv-legacy-collision', 'task-legacy-collision', 'Legacy Claude Collision', 'claude');
    legacyDb
      .prepare(`INSERT INTO conversations (id, task_id, title, provider) VALUES (?, ?, ?, ?)`)
      .run(
        'conv-wt-legacy-wt-1776065417596',
        'task-legacy-wt',
        'Legacy Claude Optimistic Alias',
        'claude'
      );
    legacyDb
      .prepare(`INSERT INTO conversations (id, task_id, title, provider) VALUES (?, ?, ?, ?)`)
      .run('conv-legacy-codex', 'task-legacy-chat', 'Legacy Codex Conversation', 'codex');

    const remap = createRemapTables();
    await portSshConnections({ appDb, legacyDb, remap });
    await portProjects({ appDb, legacyDb, remap });
    const taskResult = await portTasks({ appDb, legacyDb, remap });

    const conversationsSummary = await portConversations({
      appDb,
      legacyDb,
      remap,
      mergedLegacyTaskIds: taskResult.mergedLegacyTaskIds,
      userDataPath: userDataDir,
    });

    expect(conversationsSummary.inserted).toBe(6);

    const inserted = appSqlite
      .prepare(
        `SELECT id, title, provider FROM conversations WHERE title LIKE 'Legacy %' ORDER BY title ASC`
      )
      .all() as Array<{ id: string; title: string; provider: string | null }>;

    expect(inserted).toEqual([
      { id: mappedChatUuid, title: 'Legacy Claude Chat', provider: 'claude' },
      { id: 'conv-legacy-collision', title: 'Legacy Claude Collision', provider: 'claude' },
      { id: 'conv-legacy-invalid', title: 'Legacy Claude Invalid', provider: 'claude' },
      { id: mappedMainUuid, title: 'Legacy Claude Main', provider: 'claude' },
      { id: mappedOptimisticUuid, title: 'Legacy Claude Optimistic Alias', provider: 'claude' },
      { id: 'conv-legacy-codex', title: 'Legacy Codex Conversation', provider: 'codex' },
    ]);
  });

  it('renames legacy tmux sessions to v1 deterministic names when importing conversations', async () => {
    const { appSqlite, appDb } = createAppDb();
    const legacyDb = createLegacyDb();
    openDbs.push(appSqlite, legacyDb);

    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-port-tmux-'));
    tempDirs.push(userDataDir);

    const mappedChatUuid = '6ba95736-36d7-401e-9ef6-01655fb9162a';
    fs.writeFileSync(
      path.join(userDataDir, 'pty-session-map.json'),
      JSON.stringify({
        'claude-chat-conv-legacy-chat': { uuid: mappedChatUuid },
      }),
      'utf8'
    );

    legacyDb
      .prepare(
        `INSERT INTO projects (id, name, path, base_ref, is_remote, remote_path, ssh_connection_id) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run('proj-legacy-tmux', 'Legacy Tmux', '/legacy/tmux', 'main', 0, null, null);
    legacyDb
      .prepare(
        `INSERT INTO tasks (id, project_id, name, status, branch, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        'task-legacy-tmux',
        'proj-legacy-tmux',
        'Legacy Tmux Task',
        'running',
        'feature/tmux',
        '2026-01-03T12:00:00.000Z'
      );
    legacyDb
      .prepare(`INSERT INTO conversations (id, task_id, title, provider) VALUES (?, ?, ?, ?)`)
      .run('conv-legacy-chat', 'task-legacy-tmux', 'Legacy Claude Chat', 'claude');

    const calls: Array<{ command: string; args?: string[] }> = [];
    const tmuxExec = async (command: string, args?: string[]) => {
      calls.push({ command, args });
      if (
        command === 'tmux' &&
        args?.[0] === 'has-session' &&
        args[2] !== 'emdash-claude-chat-conv-legacy-chat'
      ) {
        throw new Error('missing');
      }
      return { stdout: '', stderr: '' };
    };

    const remap = createRemapTables();
    await portSshConnections({ appDb, legacyDb, remap });
    await portProjects({ appDb, legacyDb, remap });
    const taskResult = await portTasks({ appDb, legacyDb, remap });

    await portConversations({
      appDb,
      legacyDb,
      remap,
      mergedLegacyTaskIds: taskResult.mergedLegacyTaskIds,
      userDataPath: userDataDir,
      tmuxExec,
    });

    const newTmuxName = makeTmuxSessionName(
      makePtySessionId('proj-legacy-tmux', 'task-legacy-tmux', mappedChatUuid)
    );

    expect(calls).toEqual([
      {
        command: 'tmux',
        args: ['has-session', '-t', 'emdash-claude-chat-conv-legacy-chat'],
      },
      {
        command: 'tmux',
        args: ['has-session', '-t', newTmuxName],
      },
      {
        command: 'tmux',
        args: ['rename-session', '-t', 'emdash-claude-chat-conv-legacy-chat', newTmuxName],
      },
    ]);
  });
});
