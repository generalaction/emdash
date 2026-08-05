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
const hostConversations = {
  create: vi.fn(async (input: { id: string }) => ({ success: true as const, data: input })),
  delete: vi.fn(async () => ({ success: true as const, data: undefined })),
};
const runtimes = {
  client: vi.fn(async () => ({
    success: true as const,
    data: { conversations: hostConversations },
  })),
} as never;

function createTask(
  _db: typeof db,
  _projects: typeof projects,
  _operations: typeof operations,
  params: Parameters<typeof createTaskOperation>[5]
) {
  return createTaskOperation(db, projects, operations, placement, runtimes, params);
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
    workspaceId: values.workspaceId ?? null,
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
    // Conversation-registry purge checks that no live (tracked) rows remain first.
    select: () => ({ from: () => ({ where: () => ({ all: () => [] }) }) }),
  };
}

/** Sets up db.select to return the project row's repository workspace link. */
function setupSelectMock() {
  mocks.select.mockImplementation((selection?: unknown) =>
    selection
      ? {
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([{ repositoryWorkspaceId: 'repo-workspace' }]),
            }),
          }),
        }
      : {
          from: () => ({
            where: () => ({
              limit: () => ({
                get: () => mocks.registryRows.shift(),
                all: () => {
                  const row = mocks.registryRows.shift();
                  return row === undefined ? [] : [row];
                },
              }),
            }),
          }),
        }
  );
}

/** Points the project session mock at a remote (SSH) host. */
function makeProjectRemote() {
  mocks.getProject.mockReturnValue({
    project: { id: 'project-1', path: '/repo' },
    repoPath: '/repo',
    host: hostRef('remote', 'conn-1'),
    settings: {
      get: vi.fn(async () => ({ preservePatterns: ['.env'] })),
      getPushRemote: vi.fn(async () => 'origin'),
    },
  });
}

describe('createTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProject.mockReturnValue({
      project: { id: 'project-1', path: '/repo' },
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
      makeProjectRemote();
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
      makeProjectRemote();
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

    it('refuses repository-instance creation when the remote host is unreachable', async () => {
      makeProjectRemote();
      mocks.hostIsReachable.mockReturnValue(false);
      const { captured } = setupTransactionMock();

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

      // One rule (spec §6.3): this path was previously ungated because it only
      // wrote client SQLite; under host residency it refuses like new-worktree.
      expect(result.success).toBe(false);
      expect(captured).toHaveLength(0);
      expect(mocks.transaction).not.toHaveBeenCalled();
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
      // Workspace untrack + task-row delete; no initial conversation exists here, so the
      // registry-mediated conversation rollback contributes no mutations.
      expect(mutationRuns).toHaveBeenCalledTimes(2);
    });
  });

  describe('host-first conversation record (spec §6.2)', () => {
    const worktreeParams = {
      id: 'task-1',
      projectId: 'project-1',
      taskConfig: {
        version: '1' as const,
        name: 'Test Task',
        initialConversation: {
          id: 'conv-1',
          provider: 'claude-code',
          type: 'acp' as const,
          title: 'First conversation',
          initialQueue: [{ text: 'do the thing' }],
        },
      },
      workspaceConfig: {
        version: '2' as const,
        git: {
          kind: 'create-branch' as const,
          branchName: 'feature/test',
          fromBranch: { type: 'local' as const, branch: 'main' },
        },
        workspace: { kind: 'new-worktree' as const },
      },
    };

    it('registers the record on the host before the desktop commit, path frozen and prompt in config', async () => {
      setupTransactionMock();

      const result = await createTask(db, projects, operations, worktreeParams);
      expect(result.success).toBe(true);

      expect(hostConversations.create).toHaveBeenCalledTimes(1);
      const hostInput = hostConversations.create.mock.calls[0][0] as Record<string, unknown>;
      const outboxInput = mocks.submitWithTombstone.mock.calls[0][1] as Record<string, unknown>;
      // conv.path-frozen: the record is born dangling with the Placement-computed
      // path already frozen — identical to the path the pending worktree operation
      // (and any same-path retry of it) will materialize.
      expect(hostInput.workspacePath).toBe(outboxInput.workspacePath);
      expect(hostInput.cwd).toBe(outboxInput.workspacePath);
      expect(hostInput).toMatchObject({
        id: 'conv-1',
        provider: 'claude-code',
        type: 'acp',
        idRegime: 'provider-minted',
        title: 'First conversation',
        config: expect.objectContaining({ initialQueue: [{ text: 'do the thing' }] }),
      });
      // Host-first ordering: index registration precedes the desktop transaction.
      expect(hostConversations.create.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.submitWithTombstone.mock.invocationCallOrder[0]
      );
    });

    it('fails creation without a desktop commit when host registration fails', async () => {
      setupTransactionMock();
      hostConversations.create.mockResolvedValueOnce({
        success: false,
        error: { type: 'immutable-field-mismatch', message: 'id reuse' },
      } as never);

      const result = await createTask(db, projects, operations, worktreeParams);

      expect(result).toEqual({
        success: false,
        error: { type: 'provision-failed', message: 'id reuse' },
      });
      expect(mocks.submitWithTombstone).not.toHaveBeenCalled();
      expect(hostConversations.delete).not.toHaveBeenCalled();
    });

    it('compensates with a direct foreground delete when the desktop commit fails', async () => {
      const { captured } = setupTransactionMock();
      mocks.submitWithTombstone.mockImplementationOnce(
        async (
          _definition: unknown,
          _input: unknown,
          options: { tombstone(tx: unknown): number; revertTombstone(tx: unknown): void }
        ) => {
          options.tombstone(fakeTx(captured));
          options.revertTombstone(fakeTx(captured));
          return { success: false, error: { type: 'operation-conflict', message: 'conflict' } };
        }
      );

      const result = await createTask(db, projects, operations, worktreeParams);

      expect(result.success).toBe(false);
      expect(hostConversations.delete).toHaveBeenCalledWith({ id: 'conv-1' });
    });

    it('freezes the existing workspace path for repository-instance targets', async () => {
      const { captured } = setupTransactionMock();
      mocks.registryRows.push({ id: 'ws-repo-1', path: '/repo' });

      const result = await createTask(db, projects, operations, {
        ...worktreeParams,
        taskConfig: {
          ...worktreeParams.taskConfig,
          initialConversation: {
            ...worktreeParams.taskConfig.initialConversation,
            type: 'pty' as const,
            initialQueue: undefined,
            initialPrompt: 'do the thing',
          },
        },
        workspaceConfig: {
          version: '2',
          git: { kind: 'none' },
          workspace: { kind: 'repository-instance', workspaceId: 'ws-repo-1' },
        },
      });
      expect(result.success).toBe(true);

      const hostInput = hostConversations.create.mock.calls[0][0] as Record<string, unknown>;
      expect(hostInput).toMatchObject({
        workspacePath: '/repo',
        cwd: '/repo',
        idRegime: 'emdash-chosen',
        config: expect.objectContaining({ initialPrompt: 'do the thing' }),
      });
      // captured[0]=task, captured[1]=conversation registry row with the same frozen path.
      const convInsert = captured[1] as Record<string, unknown>;
      expect(convInsert).toMatchObject({ id: 'conv-1', workspacePath: '/repo', cwd: '/repo' });
    });
  });
});
