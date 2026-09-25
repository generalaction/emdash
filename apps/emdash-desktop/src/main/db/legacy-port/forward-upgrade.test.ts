import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import type { WorkspaceRecord } from '@emdash/core/runtimes/workspace-registry/api';
import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import { ok } from '@emdash/shared';
import { openFixture } from '@tooling/utils/db';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { launchTuiConversation } from '@core/features/conversations/node/launch-tui-conversation';
import { ConversationBackfillService } from '@core/features/conversations/node/sync/conversation-backfill';
import { TaskService } from '@core/features/tasks/api/node/task-service';
import { WorkspaceRegistryBackfillService } from '@core/features/workspaces/node/sync/workspace-registry-backfill';
import { createWorkspaceIdentityService } from '@core/features/workspaces/node/workspace-identity-source';
import { AppDbKeyValueStore } from '@core/services/app-db/node/key-value-store';
import { conversations, kv, projects, tasks, workspaces } from '@core/services/app-db/node/schema';
import { runLegacyPort, type LegacyPortStatus } from './service';

const resumeId = '12345678-1234-4234-8234-123456789abc';

describe.each([
  ['Windows', 'C:\\Users\\Robin\\repo', 'C:\\Users\\Robin\\worktrees\\old'],
  ['POSIX', '/home/robin/repo', '/home/robin/worktrees/old'],
])('v0 forward upgrade on %s', (_platform, repositoryPath, taskPath) => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;
  let directory: string;

  beforeEach(async () => {
    fixture = await openFixture('empty');
    directory = mkdtempSync(join(tmpdir(), 'emdash-forward-upgrade-'));
    const legacy = new Database(join(directory, 'emdash.db'));
    // Relevant columns from v0.4.51, with an existing worktree and Claude session.
    legacy.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, path TEXT, base_ref TEXT, is_remote INTEGER, created_at TEXT, updated_at TEXT);
      CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT, name TEXT, branch TEXT, path TEXT, status TEXT, use_worktree INTEGER, created_at TEXT, updated_at TEXT);
      CREATE TABLE conversations (id TEXT PRIMARY KEY, task_id TEXT, title TEXT, provider TEXT, created_at TEXT, updated_at TEXT);
    `);
    legacy
      .prepare('INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('old-project', 'Old project', repositoryPath, 'main', 0, '2026-01-01', '2026-01-01');
    legacy
      .prepare('INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        'old-task',
        'old-project',
        'Old task',
        'feature/old',
        taskPath,
        'idle',
        1,
        '2026-01-01',
        '2026-01-01'
      );
    legacy
      .prepare('INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        'direct-task',
        'old-project',
        'Direct task',
        'main',
        repositoryPath,
        'idle',
        0,
        '2026-01-01',
        '2026-01-01'
      );
    legacy
      .prepare('INSERT INTO conversations VALUES (?, ?, ?, ?, ?, ?)')
      .run(
        'old-conversation',
        'old-task',
        'Old Claude conversation',
        'claude',
        '2026-01-01',
        '2026-01-01'
      );
    legacy.close();
    writeFileSync(
      join(directory, 'pty-session-map.json'),
      JSON.stringify({
        'claude-chat-old-conversation': { uuid: resumeId },
      })
    );
  });

  afterEach(() => {
    fixture.close();
    rmSync(directory, { recursive: true, force: true });
  });

  async function importLegacy() {
    const state = new AppDbKeyValueStore<{ status: LegacyPortStatus }>(fixture.db, 'legacyPort');
    await runLegacyPort(directory, {
      appDb: fixture.sqlite,
      stateStore: {
        getStatus: () => state.get('status'),
        setStatus: (status) => state.setOrThrow('status', status),
      },
    });
    expect(await state.get('status')).toBe('completed');
  }

  it('registers and opens imported worktrees and resumes the original conversation', async () => {
    // Host registration may already have completed before the user starts an import.
    // New rows must still be registered before live observation resumes.
    fixture.db
      .insert(kv)
      .values([
        {
          key: 'workspace-registry-backfill:local',
          value: JSON.stringify({ version: 3, completedAt: 1 }),
        },
        { key: 'conversation-backfill:local', value: '1' },
      ])
      .run();
    await importLegacy();
    const task = fixture.db.select().from(tasks).where(eq(tasks.id, 'old-task')).get()!;
    const workspace = fixture.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, task.workspaceId!))
      .get()!;
    expect(workspace.path).toBe(taskPath);
    const direct = fixture.db.select().from(tasks).where(eq(tasks.id, 'direct-task')).get()!;
    expect(direct.workspaceId).toBe(
      fixture.db.select().from(projects).get()?.repositoryWorkspaceId
    );
    expect(fixture.db.select().from(conversations).get()).toMatchObject({
      id: resumeId,
      cwd: taskPath,
      workspacePath: taskPath,
      providerSessionId: resumeId,
    });
    await assertUsableImport();
  });

  async function assertUsableImport() {
    const hostRecords = new Map<string, WorkspaceRecord>();
    const createWorkspace = vi.fn(
      async ({ workspaceId, path }: { workspaceId: string; path: string }) => {
        const record: WorkspaceRecord = {
          id: workspaceId,
          path,
          kind: path === repositoryPath ? 'repository' : 'worktree',
          parentId:
            path === repositoryPath
              ? null
              : fixture.db.select().from(projects).get()!.repositoryWorkspaceId,
          origin: 'registered',
          gitAdminName: null,
          observedStatus: 'present',
          creation: null,
          lastCreateOutcome: null,
          lifecycle: null,
          lastRemovalAttempt: null,
          git: null,
          lastActivatedAt: null,
          createdAt: 1,
          updatedAt: 1,
          lastObservedAt: 1,
          config: null,
          runtime: null,
        };
        hostRecords.set(workspaceId, record);
        return ok(record);
      }
    );
    const activateWorkspace = vi.fn(async ({ workspaceId }: { workspaceId: string }) => {
      expect(hostRecords.get(workspaceId)?.path).toBe(taskPath);
      return ok(undefined);
    });
    const createWorktree = vi.fn();
    const createConversation = vi.fn(async () =>
      ok({ providerSessionId: null, lastSpawnedAt: null })
    );
    const reportSession = vi.fn(async () => ok(undefined));
    const runtimes = {
      client: async () =>
        ok({
          workspaceRegistry: { createWorkspace, activateWorkspace, createWorktree },
          conversations: {
            create: createConversation,
            reports: { providerSessionId: reportSession },
          },
          files: {},
          tuiAgents: {},
        }),
    } as unknown as RuntimeBroker;
    expect(
      await new WorkspaceRegistryBackfillService({ db: fixture.db, runtimes }).backfillHost(
        LOCAL_HOST_REF
      )
    ).toEqual({ status: 'complete' });
    await new ConversationBackfillService({ db: fixture.db, runtimes }).backfillHost(
      LOCAL_HOST_REF
    );
    expect(createWorkspace).toHaveBeenCalledWith(expect.objectContaining({ path: taskPath }));
    expect(createConversation).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: resumeId, cwd: taskPath })
    );
    expect(reportSession).toHaveBeenCalledWith({
      conversationId: resumeId,
      providerSessionId: resumeId,
    });

    const ensureSession = vi.fn(async () => ({ outcome: 'started' as const }));
    const registered = vi.fn();
    const service = new TaskService({
      db: fixture.db,
      projects: { requireAttached: () => ok({ projectId: 'old-project' }) },
      sessions: {
        getTask: () => undefined,
        withWorkspaceLifecycle: (_id: string, work: () => Promise<unknown>) => work(),
        registerTask: registered,
      },
      runtimes,
      lifecycleParticipants: [],
      creations: { pending: () => undefined },
      workspaceIdentity: createWorkspaceIdentityService({ db: fixture.db }),
      sessionLaunchContexts: { bind: vi.fn() },
      createConversationProvider: () => ({ ensureSession }),
    } as never);
    expect(await service.provisionWorkspace('old-task')).toMatchObject({
      success: true,
      data: { path: taskPath },
    });
    expect(activateWorkspace).toHaveBeenCalledOnce();
    expect(createWorktree).not.toHaveBeenCalled();
    expect(registered).toHaveBeenCalledOnce();
    await launchTuiConversation({
      projectId: 'old-project',
      taskId: 'old-task',
      conversationId: resumeId,
      database: fixture.db,
      telemetry: { capture: vi.fn() },
      taskSessions: { getTask: () => ({ conversations: { ensureSession } }) as never },
    });
    expect(ensureSession).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'resume',
        conversation: expect.objectContaining({ sessionId: resumeId }),
      })
    );
  }
});
