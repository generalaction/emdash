import crypto from 'node:crypto';
import { ok } from '@emdash/shared';
import { openFixture } from '@tooling/utils/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectProvider } from '@main/core/projects/project-provider';
import { projects, tasks, workspaces } from '@main/db/schema';
import type { Task } from '@shared/core/tasks/tasks';
import { WorkspaceBootstrapService } from './workspace-bootstrap-service';
import { computeWorkspaceKey } from './workspace-key';

const mocks = vi.hoisted(() => ({
  acquireWorkspace: vi.fn(),
  releaseWorkspace: vi.fn(),
  buildTaskFromWorkspace: vi.fn(),
  emitTaskProvisionProgress: vi.fn(),
}));

// Prevent the module-level singleton from attempting to open the Electron app DB.
vi.mock('@main/db/client', () => ({ db: {}, sqlite: {} }));

vi.mock('@main/core/tasks/task-builder', () => ({
  buildTaskFromWorkspace: mocks.buildTaskFromWorkspace,
  emitTaskProvisionProgress: mocks.emitTaskProvisionProgress,
}));

vi.mock('./workspace-registry', () => ({
  workspaceRegistry: {
    acquire: mocks.acquireWorkspace,
    release: mocks.releaseWorkspace,
  },
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
    fixture = await openFixture('empty');
    svc = new WorkspaceBootstrapService(fixture.db);

    await fixture.db.insert(projects).values({ id: 'proj-1', name: 'Test Project', path: '/repo' });
    await fixture.db.insert(workspaces).values({ id: WS_ID, type: 'local' });

    mocks.acquireWorkspace.mockResolvedValue({
      git: {
        getWorktreeGitDir: vi.fn().mockResolvedValue('worktrees/task-branch'),
      },
    });
    mocks.releaseWorkspace.mockResolvedValue(undefined);
    mocks.buildTaskFromWorkspace.mockResolvedValue({
      taskProvider: {
        taskId: 'task-1',
        taskBranch: 'task/branch',
        sourceBranch: { type: 'local', branch: 'main' },
        taskEnvVars: {},
        conversations: {},
        terminals: {},
      },
    });
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
    it('repairs persisted branch worktree paths at the stored path before acquiring', async () => {
      const serveBranchWorktreeAtPath = vi.fn().mockResolvedValue(ok('/worktrees/stored-task'));
      const existsAbsolute = vi.fn().mockResolvedValue(true);
      const project = {
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
        gitRepositoryFetchService: {},
        worktreeHost: {
          existsAbsolute,
        },
        worktreeService: {
          serveBranchWorktreeAtPath,
        },
      } as unknown as ProjectProvider;

      const result = await svc.ensureWorkspaceSetup(
        {
          id: WS_ID,
          type: 'local',
          kind: 'worktree',
          path: '/worktrees/stored-task',
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

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('expected success');
      expect(result.data.path).toBe('/worktrees/stored-task');
      expect(serveBranchWorktreeAtPath).toHaveBeenCalledWith(
        'task/branch',
        {
          type: 'local',
          branch: 'main',
        },
        '/worktrees/stored-task'
      );
      expect(existsAbsolute).not.toHaveBeenCalledWith('/worktrees/stored-task');
      expect(mocks.acquireWorkspace).toHaveBeenCalled();

      const [ws] = await fixture.db.select().from(workspaces).where(eq(workspaces.id, WS_ID));
      expect(ws.path).toBe('/worktrees/stored-task');
      expect(ws.branchName).toBe('task/branch');
    });
  });
});
