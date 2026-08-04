import { formatHostRef, hostRef } from '@emdash/core/primitives/host/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskRow } from '@core/services/app-db/node/schema';
import { createTask as createTaskOperation } from './createTask';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  getProject: vi.fn(),
  select: vi.fn(),
  hasClaimConflict: vi.fn(),
  hostIsReachable: vi.fn(),
  submitWithTombstone: vi.fn(),
  resolveWorktreeRoot: vi.fn(),
  registryRows: [] as unknown[],
}));
const operations = {
  hasClaimConflict: mocks.hasClaimConflict,
  hostIsReachable: mocks.hostIsReachable,
  submitWithTombstone: mocks.submitWithTombstone,
} as never;
const db = { transaction: mocks.transaction, select: mocks.select } as never;
const projects = { getProject: mocks.getProject };
const placement = { resolveWorktreeRoot: mocks.resolveWorktreeRoot };

function createTask(
  _db: typeof db,
  _projects: typeof projects,
  _operations: typeof operations,
  params: Parameters<typeof createTaskOperation>[4]
) {
  return createTaskOperation(db, projects, operations, placement, params);
}

function makeTaskRow(values: Partial<TaskRow>): TaskRow {
  return {
    id: values.id ?? 'task-1',
    projectId: values.projectId ?? 'project-1',
    name: values.name ?? 'Test Task',
    status: values.status ?? 'in_progress',
    sourceBranch: values.sourceBranch ?? null,
    taskBranch: values.taskBranch ?? null,
    linkedIssue: values.linkedIssue ?? null,
    archivedAt: values.archivedAt ?? null,
    deletedAt: values.deletedAt ?? null,
    createdAt: values.createdAt ?? '2026-05-18 12:00:00',
    updatedAt: values.updatedAt ?? '2026-05-18 12:00:00',
    lastInteractedAt: values.lastInteractedAt ?? null,
    statusChangedAt: values.statusChangedAt ?? '2026-05-18 12:00:00',
    isPinned: values.isPinned ?? 0,
    workspaceProvider: values.workspaceProvider ?? null,
    workspaceId: values.workspaceId ?? null,
    workspaceProviderData: values.workspaceProviderData ?? null,
    workspaceIntent: values.workspaceIntent ?? null,
    type: values.type ?? 'task',
    automationRunId: values.automationRunId ?? null,
  };
}

/**
 * Sets up db.transaction to invoke the callback with a fake `tx`.
 * The fake tx captures insert values by call order (0=task, 1=workspace if any, 2=conversation).
 * Returns an array that is populated with each set of insert values as the callback runs.
 */
function setupTransactionMock() {
  const captured: unknown[] = [];

  mocks.transaction.mockImplementation((cb: (tx: unknown) => void) => {
    captured.length = 0;
    return cb(fakeTx(captured));
  });
  mocks.submitWithTombstone.mockImplementation(
    async (_definition: unknown, _input: unknown, options: { tombstone(tx: unknown): number }) => {
      options.tombstone(fakeTx(captured));
      return { success: true, data: { operationId: 'operation-1' } };
    }
  );

  return { captured };
}

function fakeTx(captured: unknown[]) {
  return {
    insert: () => ({
      values: (vals: unknown) => {
        captured.push(vals);
        return {
          returning: () => ({
            all: () => [makeTaskRow(vals as Partial<TaskRow>)],
            get: () => vals,
          }),
          run: () => {},
        };
      },
    }),
    update: () => ({
      set: () => ({ where: () => ({ run: () => ({ changes: 1 }) }) }),
    }),
    delete: () => ({ where: () => ({ run: () => ({ changes: 1 }) }) }),
  };
}

/** Sets up db.select to return a local project row. */
function setupSelectMock(workspaceProvider = 'local', sshConnectionId: string | null = null) {
  mocks.select.mockImplementation((selection?: unknown) =>
    selection
      ? {
          from: () => ({
            where: () => ({
              limit: () =>
                Promise.resolve([
                  { workspaceProvider, sshConnectionId, repositoryWorkspaceId: 'repo-workspace' },
                ]),
            }),
          }),
        }
      : {
          from: () => ({
            where: () => ({
              limit: () => ({ get: () => mocks.registryRows.shift() }),
            }),
          }),
        }
  );
}

describe('createTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProject.mockReturnValue({
      project: { id: 'project-1', path: '/repo', workspaceProvider: 'local' },
      repoPath: '/repo',
      host: hostRef('local', 'local'),
      settings: {
        get: vi.fn(async () => ({ preservePatterns: ['.env'] })),
        getPushRemote: vi.fn(async () => 'origin'),
      },
    });
    mocks.hasClaimConflict.mockResolvedValue(false);
    mocks.hostIsReachable.mockReturnValue(true);
    mocks.resolveWorktreeRoot.mockResolvedValue({ success: true, data: '/worktrees' });
    mocks.registryRows.length = 0;
    setupTransactionMock();
    setupSelectMock();
  });

  it('returns project-not-found when project does not exist', async () => {
    mocks.getProject.mockReturnValue(undefined);
    const result = await createTask(db, projects, operations, {
      id: 'task-1',
      projectId: 'project-1',
      taskConfig: { version: '1', name: 'Test Task' },
      workspaceConfig: {
        version: '2',
        git: { kind: 'none' },
        workspace: { kind: 'repository-instance', workspaceId: 'ws-repo-1' },
      },
    });
    expect(result).toEqual({ success: false, error: { type: 'project-not-found' } });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('executes all writes inside a single db.transaction call', async () => {
    await createTask(db, projects, operations, {
      id: 'task-1',
      projectId: 'project-1',
      taskConfig: { version: '1', name: 'Test Task' },
      workspaceConfig: {
        version: '2',
        git: { kind: 'none' },
        workspace: { kind: 'repository-instance', workspaceId: 'ws-repo-1' },
      },
    });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it('does not write taskBranch or sourceBranch to the tasks row', async () => {
    const { captured } = setupTransactionMock();

    await createTask(db, projects, operations, {
      id: 'task-1',
      projectId: 'project-1',
      taskConfig: { version: '1', name: 'Test Task' },
      workspaceConfig: {
        version: '2',
        git: {
          kind: 'create-branch',
          branchName: 'feature/x',
          fromBranch: { type: 'local', branch: 'main' },
        },
        workspace: { kind: 'new-worktree' },
      },
    });

    const taskInsert = captured[0] as Record<string, unknown>;
    expect(taskInsert).not.toEqual(
      expect.objectContaining({ taskBranch: expect.anything(), sourceBranch: expect.anything() })
    );
  });

  it('includes workspaceId in the task row insert', async () => {
    const { captured } = setupTransactionMock();

    await createTask(db, projects, operations, {
      id: 'task-1',
      projectId: 'project-1',
      taskConfig: { version: '1', name: 'Test Task' },
      workspaceConfig: {
        version: '2',
        git: { kind: 'none' },
        workspace: { kind: 'repository-instance', workspaceId: 'ws-repo-1' },
      },
    });

    const taskInsert = captured[0] as Record<string, unknown>;
    expect(taskInsert.workspaceId).toBeDefined();
    expect(typeof taskInsert.workspaceId).toBe('string');
  });

  describe('repository-instance workspace target', () => {
    it('reuses the existing workspace ID from config', async () => {
      const { captured } = setupTransactionMock();
      await createTask(db, projects, operations, {
        id: 'task-1',
        projectId: 'project-1',
        taskConfig: { version: '1', name: 'Test Task' },
        workspaceConfig: {
          version: '2',
          git: { kind: 'none' },
          workspace: { kind: 'repository-instance', workspaceId: 'ws-repo-1' },
        },
      });

      // Only the task row is inserted — no workspace insert.
      expect(captured).toHaveLength(1);
      expect((captured[0] as Record<string, unknown>).workspaceId).toBe('ws-repo-1');
    });

    it('does not insert a new workspace row', async () => {
      const { captured } = setupTransactionMock();
      await createTask(db, projects, operations, {
        id: 'task-1',
        projectId: 'project-1',
        taskConfig: { version: '1', name: 'Test Task' },
        workspaceConfig: {
          version: '2',
          git: { kind: 'none' },
          workspace: { kind: 'repository-instance', workspaceId: 'ws-repo-1' },
        },
      });

      // captured[0] = task. No workspace insert at index 1.
      expect(captured).toHaveLength(1);
    });
  });

  describe('new-worktree workspace target', () => {
    it('inserts a workspace row with kind=worktree and the config serialized', async () => {
      const { captured } = setupTransactionMock();
      const workspaceConfig = {
        version: '2' as const,
        git: {
          kind: 'create-branch' as const,
          branchName: 'feature/test',
          fromBranch: { type: 'local' as const, branch: 'main' },
          pushBranch: true,
        },
        workspace: { kind: 'new-worktree' as const },
      };

      await createTask(db, projects, operations, {
        id: 'task-1',
        projectId: 'project-1',
        taskConfig: { version: '1', name: 'Test Task' },
        workspaceConfig,
      });

      // captured[0]=task, captured[1]=workspace
      expect(captured).toHaveLength(2);
      const wsInsert = captured[1] as Record<string, unknown>;
      expect(wsInsert.kind).toBe('worktree');
      expect(wsInsert.location).toBe('local');
      expect(wsInsert.config).toEqual(workspaceConfig);
      expect(wsInsert.path).toMatch(/^\/worktrees\/repo-[a-f0-9]{8}\/feature-test$/u);
      expect(wsInsert.key).toBeUndefined();
      expect(mocks.submitWithTombstone).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'host-create-worktree' }),
        expect.objectContaining({
          repoPath: '/repo',
          workspacePath: wsInsert.path,
          branchName: 'feature/test',
          startPoint: 'main',
          pushRemote: 'origin',
          preservePatterns: ['.env'],
        }),
        expect.any(Object)
      );
    });

    it('does not request a push when pushBranch is not set', async () => {
      setupTransactionMock();

      await createTask(db, projects, operations, {
        id: 'task-1',
        projectId: 'project-1',
        taskConfig: { version: '1', name: 'Test Task' },
        workspaceConfig: {
          version: '2',
          git: {
            kind: 'create-branch',
            branchName: 'feature/no-push',
            fromBranch: { type: 'local', branch: 'main' },
          },
          workspace: { kind: 'new-worktree' },
        },
      });

      expect(mocks.submitWithTombstone).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ pushRemote: undefined }),
        expect.any(Object)
      );
    });

    it('sets location=remote and type=project-ssh for SSH projects', async () => {
      setupSelectMock('ssh', 'conn-1');
      const { captured } = setupTransactionMock();

      await createTask(db, projects, operations, {
        id: 'task-1',
        projectId: 'project-1',
        taskConfig: { version: '1', name: 'Test Task' },
        workspaceConfig: {
          version: '2',
          git: {
            kind: 'create-branch',
            branchName: 'feature/ssh',
            fromBranch: { type: 'local', branch: 'main' },
          },
          workspace: { kind: 'new-worktree' },
        },
      });

      const wsInsert = captured[1] as Record<string, unknown>;
      expect(wsInsert.kind).toBe('worktree');
      expect(wsInsert.location).toBe('remote');
      expect(wsInsert.type).toBe('project-ssh');
      expect(wsInsert.sshConnectionId).toBe('conn-1');
    });

    it('refuses creation when the remote host is unreachable', async () => {
      setupSelectMock('ssh', 'conn-1');
      mocks.hostIsReachable.mockReturnValue(false);
      const { captured } = setupTransactionMock();

      const result = await createTask(db, projects, operations, {
        id: 'task-1',
        projectId: 'project-1',
        taskConfig: { version: '1', name: 'Test Task' },
        workspaceConfig: {
          version: '2',
          git: {
            kind: 'create-branch',
            branchName: 'feature/ssh',
            fromBranch: { type: 'local', branch: 'main' },
          },
          workspace: { kind: 'new-worktree' },
        },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('provision-failed');
      }
      expect(mocks.hostIsReachable).toHaveBeenCalledWith(
        formatHostRef(hostRef('remote', 'conn-1'))
      );
      expect(captured).toHaveLength(0);
    });

    it('suffixes paths against live Registry rows without probing the host', async () => {
      mocks.registryRows.push({ id: 'existing' });

      await createTask(db, projects, operations, {
        id: 'task-1',
        projectId: 'project-1',
        taskConfig: { version: '1', name: 'Test Task' },
        workspaceConfig: {
          version: '2',
          git: {
            kind: 'create-branch',
            branchName: 'feature/test',
            fromBranch: { type: 'local', branch: 'main' },
          },
          workspace: { kind: 'new-worktree' },
        },
      });

      expect(mocks.submitWithTombstone).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          workspacePath: expect.stringMatching(/\/feature-test-2$/u),
        }),
        expect.anything()
      );
    });

    it('untracks the Registry row and rolls back task rows when enqueue is rejected', async () => {
      const { captured } = setupTransactionMock();
      const mutationRuns = vi.fn(() => ({ changes: 1 }));
      mocks.submitWithTombstone.mockImplementationOnce(
        async (
          _definition: unknown,
          _input: unknown,
          options: {
            tombstone(tx: unknown): number;
            revertTombstone(tx: unknown): void;
          }
        ) => {
          const tx = {
            ...fakeTx(captured),
            update: () => ({
              set: () => ({ where: () => ({ run: mutationRuns }) }),
            }),
            delete: () => ({ where: () => ({ run: mutationRuns }) }),
          };
          options.tombstone(tx);
          options.revertTombstone(tx);
          return {
            success: false,
            error: { type: 'operation-conflict', message: 'conflict' },
          };
        }
      );

      const result = await createTask(db, projects, operations, {
        id: 'task-1',
        projectId: 'project-1',
        taskConfig: { version: '1', name: 'Test Task' },
        workspaceConfig: {
          version: '2',
          git: {
            kind: 'create-branch',
            branchName: 'feature/test',
            fromBranch: { type: 'local', branch: 'main' },
          },
          workspace: { kind: 'new-worktree' },
        },
      });

      expect(result).toEqual({
        success: false,
        error: { type: 'provision-failed', message: 'conflict' },
      });
      expect(mutationRuns).toHaveBeenCalledTimes(3);
    });
  });

  describe('byoi workspace target', () => {
    it('refuses BYOI creation without inserting a workspace', async () => {
      const { captured } = setupTransactionMock();
      const result = await createTask(db, projects, operations, {
        id: 'task-1',
        projectId: 'project-1',
        taskConfig: { version: '1', name: 'Test Task' },
        workspaceConfig: {
          version: '2',
          git: { kind: 'none' },
          workspace: { kind: 'byoi' },
        },
      });

      expect(result).toEqual({
        success: false,
        error: { type: 'provision-failed', message: 'BYOI workspaces are no longer supported.' },
      });
      expect(captured).toEqual([]);
    });
  });
});
