import { beforeEach, describe, expect, it, vi } from 'vitest';

const ipcHandleHandlers = new Map<string, (...args: any[]) => any>();

const claimReserveMock = vi.fn();
const saveTaskMock = vi.fn();
const getProjectByIdMock = vi.fn();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, cb: (...args: any[]) => any) => {
      ipcHandleHandlers.set(channel, cb);
    }),
  },
}));

vi.mock('../../main/services/WorktreeService', () => ({
  worktreeService: {
    createWorktree: vi.fn(),
    listWorktrees: vi.fn(),
    removeWorktree: vi.fn(),
    getWorktreeStatus: vi.fn(),
    mergeWorktreeChanges: vi.fn(),
    getWorktree: vi.fn(),
    getAllWorktrees: vi.fn(),
  },
}));

vi.mock('../../main/services/WorktreePoolService', () => ({
  worktreePoolService: {
    ensureReserve: vi.fn(),
    hasReserve: vi.fn(),
    claimReserve: (...args: any[]) => claimReserveMock(...args),
    removeReserve: vi.fn(),
  },
}));

vi.mock('../../main/services/DatabaseService', () => ({
  databaseService: {
    getProjectById: (...args: any[]) => getProjectByIdMock(...args),
    saveTask: (...args: any[]) => saveTaskMock(...args),
    getProjects: vi.fn(),
  },
}));

vi.mock('../../main/db/drizzleClient', () => ({
  getDrizzleClient: vi.fn(),
}));

vi.mock('../../main/services/RemoteGitService', () => ({
  RemoteGitService: vi.fn().mockImplementation(() => ({
    createWorktree: vi.fn(),
    listWorktrees: vi.fn(),
    removeWorktree: vi.fn(),
    getWorktreeStatus: vi.fn(),
  })),
}));

vi.mock('../../main/services/ssh/SshService', () => ({
  sshService: {
    executeCommand: vi.fn(),
  },
}));

vi.mock('../../main/lib/logger', () => ({
  log: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../main/utils/shellEscape', () => ({
  quoteShellArg: (value: string) => value,
}));

describe('worktreeIpc claimReserveAndSaveTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    ipcHandleHandlers.clear();
  });

  async function getHandler() {
    const { registerWorktreeIpc } = await import('../../main/services/worktreeIpc');
    registerWorktreeIpc();
    const handler = ipcHandleHandlers.get('worktree:claimReserveAndSaveTask');
    expect(handler).toBeTypeOf('function');
    return handler!;
  }

  it('claims reserve and persists task in one handler call', async () => {
    const handler = await getHandler();

    getProjectByIdMock.mockResolvedValue({
      id: 'project-1',
      isRemote: false,
    });
    claimReserveMock.mockResolvedValue({
      worktree: {
        id: 'wt-123',
        name: 'task-a',
        branch: 'emdash/task-a-abc',
        path: '/tmp/worktrees/task-a',
        projectId: 'project-1',
        status: 'active',
        createdAt: '2026-02-20T00:00:00.000Z',
      },
      needsBaseRefSwitch: false,
    });
    saveTaskMock.mockResolvedValue(undefined);

    const result = await handler(
      {},
      {
        projectId: 'project-1',
        projectPath: '/tmp/repo',
        taskName: 'task-a',
        baseRef: 'origin/main',
        task: {
          projectId: 'project-1',
          name: 'task-a',
          status: 'idle',
          agentId: 'codex',
          metadata: { initialPrompt: 'hello' },
          useWorktree: true,
        },
      }
    );

    expect(claimReserveMock).toHaveBeenCalledWith(
      'project-1',
      '/tmp/repo',
      'task-a',
      'origin/main'
    );
    expect(saveTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'wt-123',
        projectId: 'project-1',
        name: 'task-a',
        branch: 'emdash/task-a-abc',
        path: '/tmp/worktrees/task-a',
        status: 'idle',
        agentId: 'codex',
        metadata: { initialPrompt: 'hello' },
        useWorktree: true,
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        worktree: expect.objectContaining({ id: 'wt-123' }),
        task: expect.objectContaining({ id: 'wt-123' }),
      })
    );
  });

  it('returns no reserve error and does not persist task when claim misses', async () => {
    const handler = await getHandler();

    getProjectByIdMock.mockResolvedValue({
      id: 'project-1',
      isRemote: false,
    });
    claimReserveMock.mockResolvedValue(null);

    const result = await handler(
      {},
      {
        projectId: 'project-1',
        projectPath: '/tmp/repo',
        taskName: 'task-a',
        baseRef: 'origin/main',
        task: {
          projectId: 'project-1',
          name: 'task-a',
          status: 'idle',
        },
      }
    );

    expect(result).toEqual({
      success: false,
      error: 'No reserve available',
    });
    expect(saveTaskMock).not.toHaveBeenCalled();
  });

  it('returns failure when saveTask throws after a successful claim', async () => {
    const handler = await getHandler();

    getProjectByIdMock.mockResolvedValue({
      id: 'project-1',
      isRemote: false,
    });
    claimReserveMock.mockResolvedValue({
      worktree: {
        id: 'wt-456',
        name: 'task-b',
        branch: 'emdash/task-b-def',
        path: '/tmp/worktrees/task-b',
        projectId: 'project-1',
        status: 'active',
        createdAt: '2026-02-20T00:00:00.000Z',
      },
      needsBaseRefSwitch: false,
    });
    saveTaskMock.mockRejectedValue(new Error('db save failed'));

    const result = await handler(
      {},
      {
        projectId: 'project-1',
        projectPath: '/tmp/repo',
        taskName: 'task-b',
        baseRef: 'origin/main',
        task: {
          projectId: 'project-1',
          name: 'task-b',
          status: 'idle',
        },
      }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('db save failed');
  });

  it('rejects remote projects without claiming or saving', async () => {
    const handler = await getHandler();

    getProjectByIdMock.mockResolvedValue({
      id: 'remote-project',
      isRemote: true,
      sshConnectionId: 'conn-1',
      remotePath: '/srv/repo',
    });

    const result = await handler(
      {},
      {
        projectId: 'remote-project',
        projectPath: '/srv/repo',
        taskName: 'task-remote',
        baseRef: 'origin/main',
        task: {
          projectId: 'remote-project',
          name: 'task-remote',
          status: 'idle',
        },
      }
    );

    expect(result).toEqual({
      success: false,
      error: 'Remote worktree pooling is not supported yet',
    });
    expect(claimReserveMock).not.toHaveBeenCalled();
    expect(saveTaskMock).not.toHaveBeenCalled();
  });
});
