import crypto from 'node:crypto';
import { ok } from '@emdash/shared';
import type * as WireModule from '@emdash/wire';
import { openFixture } from '@tooling/utils/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectProvider } from '@core/features/projects/api/node/project-provider';
import { WorkspaceBootstrapService } from '@core/features/workspaces/api/node/workspace-bootstrap-service';
import { computeWorkspaceKey } from '@core/features/workspaces/api/node/workspace-key';
import type { Task } from '@core/primitives/tasks/api';
import { projects, tasks, workspaces } from '@core/services/app-db/node/schema';

const mocks = vi.hoisted(() => ({
  acquireWorkspace: vi.fn(),
  releaseWorkspace: vi.fn(),
  buildTaskFromWorkspace: vi.fn(),
  emitTaskProvisionProgress: vi.fn(),
  resolveWorktreePool: vi.fn(),
  startWorkspaceJob: vi.fn(),
}));

vi.mock('@emdash/wire', async (importOriginal) => {
  const actual = await importOriginal<typeof WireModule>();
  return {
    ...actual,
    createLiveJobReplica: () => ({
      start: mocks.startWorkspaceJob,
      dispose: vi.fn(async () => {}),
    }),
  };
});

vi.mock('@core/services/runtime-broker/api/clients', () => {
  return {
    getFilesRuntimeClient: vi.fn(async () => ({})),
    getWorkspaceRuntimeClient: vi.fn(async () => ({ activate: {}, deactivate: {} })),
  };
});

vi.mock('@core/features/tasks/api/node/task-builder', () => ({
  buildTaskFromWorkspace: mocks.buildTaskFromWorkspace,
  emitTaskProvisionProgress: mocks.emitTaskProvisionProgress,
}));

vi.mock('@core/features/workspaces/api/node/runtime-access', () => ({
  tryAcquireWorkspaceRuntime: mocks.acquireWorkspace,
}));

vi.mock('./placement/workspace-placement-resolver', () => ({
  workspacePlacementResolver: { resolveWorktreePool: mocks.resolveWorktreePool },
}));

vi.mock('@core/features/workspaces/node/lifecycle-participants', () => ({
  activateWorkspaceParticipants: vi.fn(),
  deactivateWorkspaceParticipants: vi.fn(),
}));

const WS_ID = 'ws-1';

const task: Task = {
  id: 'task-1',
  projectId: 'proj-1',
  name: 'Task 1',
  status: 'in_progress',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  statusChangedAt: '2026-01-01T00:00:00.000Z',
  isPinned: false,
  prs: [],
  conversations: {},
  workspaceId: WS_ID,
  type: 'task',
};

describe('WorkspaceBootstrapService', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;
  let svc: WorkspaceBootstrapService;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.resolveWorktreePool.mockResolvedValue(ok('/worktrees'));
    mocks.startWorkspaceJob.mockImplementation(async (input) => ({
      ready: vi.fn(async () => ({
        result: Promise.resolve({ path: input.lifecycle?.ref.path }),
        onProgress: vi.fn(() => () => {}),
      })),
      release: vi.fn(async () => {}),
    }));

    fixture = await openFixture('empty');
    svc = new WorkspaceBootstrapService({
      db: fixture.db,
      createConversationProvider: vi.fn(),
      getTerminalsRuntimeClient: vi.fn(async () => ({}) as never),
      getWorkspaceRuntimeClient: vi.fn(async () => ({ activate: {}, deactivate: {} }) as never),
      lifecycleParticipants: [],
      placement: { resolveWorktreePool: mocks.resolveWorktreePool } as never,
      projects: { getProject: vi.fn() },
      runtimes: {} as never,
      workspaceIdentity: { invalidate: vi.fn() } as never,
    });

    await fixture.db.insert(projects).values({ id: 'proj-1', name: 'Test Project', path: '/repo' });
    await fixture.db.insert(workspaces).values({ id: WS_ID, type: 'local' });

    mocks.acquireWorkspace.mockResolvedValue(
      ok({
        identity: {
          workspaceId: WS_ID,
          projectId: 'proj-1',
          host: { type: 'local', id: 'local' },
          path: '/repo/task',
        },
        files: {},
        release: mocks.releaseWorkspace,
      })
    );
    mocks.releaseWorkspace.mockResolvedValue(undefined);
    mocks.buildTaskFromWorkspace.mockResolvedValue(
      ok({
        taskProvider: {
          taskId: 'task-1',
          taskBranch: 'task/branch',
          sourceBranch: { type: 'local', branch: 'main' },
          taskEnvVars: {},
          conversations: {},
          terminals: {},
        },
      })
    );
  });

  afterEach(() => {
    fixture.close();
  });

  describe('persistPath', () => {
    it('updates workspace path and key, returns original workspaceId', async () => {
      const returned = await svc.persistPath(WS_ID, '/worktrees/branch', 'local');

      expect(returned).toBe(WS_ID);
      const [ws] = await fixture.db.select().from(workspaces).where(eq(workspaces.id, WS_ID));
      expect(ws.path).toBe('/worktrees/branch');
      expect(ws.key).toBe(computeWorkspaceKey('local', '/worktrees/branch'));
    });

    it('does not set a key for byoi workspaces', async () => {
      await fixture.db.update(workspaces).set({ type: 'byoi' }).where(eq(workspaces.id, WS_ID));

      await svc.persistPath(WS_ID, '/some/path', 'byoi');

      const [ws] = await fixture.db.select().from(workspaces).where(eq(workspaces.id, WS_ID));
      expect(ws.key).toBeNull();
    });

    it('returns existing workspace id on UNIQUE key conflict', async () => {
      const existingWsId = crypto.randomUUID();
      const conflictPath = '/worktrees/taken';
      const conflictKey = computeWorkspaceKey('local', conflictPath);
      await fixture.db
        .insert(workspaces)
        .values({ id: existingWsId, type: 'local', path: conflictPath, key: conflictKey });

      const returned = await svc.persistPath(WS_ID, conflictPath, 'local');

      expect(returned).toBe(existingWsId);
      const [ws] = await fixture.db.select().from(workspaces).where(eq(workspaces.id, WS_ID));
      expect(ws.path).toBeNull();
    });

    it('does not mutate branch metadata when reusing an existing workspace by key', async () => {
      const existingWsId = crypto.randomUUID();
      const conflictPath = '/worktrees/taken';
      const conflictKey = computeWorkspaceKey('local', conflictPath);
      await fixture.db.insert(workspaces).values({
        id: existingWsId,
        type: 'local',
        kind: 'worktree',
        path: conflictPath,
        key: conflictKey,
        branchName: null,
      });

      const returned = await svc.persistPath(
        WS_ID,
        conflictPath,
        'local',
        undefined,
        'task/branch'
      );

      expect(returned).toBe(existingWsId);
      const [existing] = await fixture.db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, existingWsId));
      expect(existing.branchName).toBeNull();
    });
  });

  describe('ensureWorkspaceSetupForTask', () => {
    it('returns missing-workspace when a task has no workspace id', async () => {
      await fixture.db.insert(tasks).values({
        id: 'task-missing-workspace-id',
        projectId: 'proj-1',
        name: 'Missing workspace ID',
        status: 'in_progress',
      });

      const result = await svc.ensureWorkspaceSetupForTask('task-missing-workspace-id');

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.type).toBe('missing-workspace');
    });

    it('returns missing-workspace when the workspace row is absent', async () => {
      await fixture.db.insert(tasks).values({
        id: 'task-missing-workspace-row',
        projectId: 'proj-1',
        name: 'Missing workspace row',
        status: 'in_progress',
        workspaceId: 'workspace-missing',
      });

      const result = await svc.ensureWorkspaceSetupForTask('task-missing-workspace-row');

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.type).toBe('missing-workspace');
    });
  });

  describe('ensureWorkspaceSetup', () => {
    it('repairs persisted branch worktree paths before acquiring the workspace', async () => {
      const findTaskWorktree = vi.fn().mockResolvedValue('/worktrees/task-branch');
      const reconcile = vi.fn().mockResolvedValue(
        ok({
          workspace: {},
          path: '/worktrees/task-branch',
          topology: { kind: 'worktree' },
        })
      );
      const project = {
        project: { type: 'local', id: 'proj-1', path: '/repo' },
        projectId: 'proj-1',
        type: 'local',
        repoPath: '/repo',
        configPathForDirectory: (directory: string) => `${directory}/.emdash.json`,
        defaultWorkspaceType: { kind: 'local' },
        settings: {
          get: vi.fn(),
        },
        gitRepository: {
          getConfiguredRemotes: vi.fn(),
        },
        findTaskWorktree,
        workspace: { reconcile, activate: {}, deactivate: {} },
      } as unknown as ProjectProvider;

      const result = await svc.ensureWorkspaceSetup(
        {
          id: WS_ID,
          type: 'local',
          kind: 'worktree',
          path: '/worktrees/broken-task-branch',
          branchName: 'task/branch',
          config: {
            version: '2',
            git: {
              kind: 'create-branch',
              branchName: 'task/branch',
              fromBranch: { type: 'local', branch: 'main' },
            },
            workspace: { kind: 'new-worktree' },
          },
        },
        { workspaceIntent: null, workspaceProvider: null },
        task,
        project
      );

      if (!result.success) throw new Error(JSON.stringify(result.error));
      expect(result.success).toBe(true);
      expect(result.data.path).toBe('/worktrees/task-branch');
      expect(findTaskWorktree).toHaveBeenCalledWith('task/branch');
      expect(reconcile).toHaveBeenCalled();
      expect(mocks.acquireWorkspace).toHaveBeenCalled();

      const [ws] = await fixture.db.select().from(workspaces).where(eq(workspaces.id, WS_ID));
      expect(ws.path).toBe('/worktrees/task-branch');
      expect(ws.branchName).toBe('task/branch');
    });

    it('does not acquire an explicit worktree from a stale path without branch intent', async () => {
      const findTaskWorktree = vi.fn();
      const exists = vi.fn().mockResolvedValue(ok(false));
      const project = {
        project: { type: 'local', id: 'proj-1', path: '/repo' },
        projectId: 'proj-1',
        type: 'local',
        repoPath: '/repo',
        defaultWorkspaceType: { kind: 'local' },
        settings: {
          get: vi.fn(),
        },
        gitRepository: {
          getConfiguredRemotes: vi.fn(),
        },
        findTaskWorktree,
        files: { client: { fs: { exists } } },
      } as unknown as ProjectProvider;

      const result = await svc.ensureWorkspaceSetup(
        {
          id: WS_ID,
          type: 'local',
          kind: 'worktree',
          path: '/worktrees/missing-task-branch',
          branchName: null,
          config: null,
        },
        { workspaceIntent: null, workspaceProvider: null },
        task,
        project
      );

      expect(result.success).toBe(false);
      if (result.success) throw new Error('expected failure');
      expect(result.error.type).toBe('no-intent');
      expect(exists).not.toHaveBeenCalled();
      expect(findTaskWorktree).not.toHaveBeenCalled();
      expect(mocks.acquireWorkspace).not.toHaveBeenCalled();
    });

    it('recovers an explicit worktree from legacy task branch intent', async () => {
      const project = {
        project: { type: 'local', id: 'proj-1', path: '/repo' },
        projectId: 'proj-1',
        type: 'local',
        repoPath: '/repo',
        configPathForDirectory: (directory: string) => `${directory}/.emdash.json`,
        defaultWorkspaceType: { kind: 'local' },
        settings: {
          get: vi.fn(),
        },
        gitRepository: {
          getConfiguredRemotes: vi.fn().mockResolvedValue({
            baseRemote: 'origin',
            pushRemote: 'origin',
          }),
        },
        workspace: { provision: {}, activate: {}, deactivate: {} },
      } as unknown as ProjectProvider;

      const result = await svc.ensureWorkspaceSetup(
        {
          id: WS_ID,
          type: 'local',
          kind: 'worktree',
          path: '/worktrees/missing-task-branch',
          branchName: null,
          config: null,
        },
        {
          workspaceIntent: null,
          workspaceProvider: null,
          taskBranch: 'task/branch',
        },
        task,
        project
      );

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('expected success');
      expect(result.data.path).toBe('/worktrees/task-branch');
      expect(mocks.startWorkspaceJob).toHaveBeenCalledWith(
        expect.objectContaining({
          lifecycle: expect.objectContaining({
            context: expect.objectContaining({
              worktreePoolPath: '/worktrees',
            }),
          }),
        })
      );
      expect(mocks.acquireWorkspace).toHaveBeenCalled();

      const [ws] = await fixture.db.select().from(workspaces).where(eq(workspaces.id, WS_ID));
      expect(ws.path).toBe('/worktrees/task-branch');
      expect(ws.branchName).toBe('task/branch');
    });

    it('recovers a legacy workspace with stale path from task branch intent', async () => {
      const exists = vi.fn().mockResolvedValue(ok(false));
      const project = {
        project: { type: 'local', id: 'proj-1', path: '/repo' },
        projectId: 'proj-1',
        type: 'local',
        repoPath: '/repo',
        configPathForDirectory: (directory: string) => `${directory}/.emdash.json`,
        defaultWorkspaceType: { kind: 'local' },
        settings: {
          get: vi.fn(),
        },
        gitRepository: {
          getConfiguredRemotes: vi.fn().mockResolvedValue({
            baseRemote: 'origin',
            pushRemote: 'origin',
          }),
        },
        files: { client: { fs: { exists } } },
        workspace: { provision: {}, activate: {}, deactivate: {} },
      } as unknown as ProjectProvider;

      const result = await svc.ensureWorkspaceSetup(
        {
          id: WS_ID,
          type: 'local',
          kind: null,
          path: '/worktrees/missing-task-branch',
          branchName: null,
          config: null,
        },
        {
          workspaceIntent: null,
          workspaceProvider: null,
          taskBranch: 'task/branch',
        },
        task,
        project
      );

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('expected success');
      expect(result.data.path).toBe('/worktrees/task-branch');
      expect(exists).toHaveBeenCalled();
      expect(mocks.startWorkspaceJob).toHaveBeenCalledWith(
        expect.objectContaining({ lifecycle: expect.any(Object) })
      );
      expect(mocks.acquireWorkspace).toHaveBeenCalled();

      const [ws] = await fixture.db.select().from(workspaces).where(eq(workspaces.id, WS_ID));
      expect(ws.path).toBe('/worktrees/task-branch');
      expect(ws.branchName).toBe('task/branch');
    });
  });
});
