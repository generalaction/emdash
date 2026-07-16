import { beforeEach, describe, expect, it, vi } from 'vitest';
import { teardownStoredWorkspace } from './teardown-stored-workspace';

const mocks = vi.hoisted(() => ({
  acquire: vi.fn(),
  connect: vi.fn(),
  createWorkspaceFactory: vi.fn(),
  teardown: vi.fn(),
}));

vi.mock('@main/core/runtime/runtime-manager', () => ({ runtimeManager: {} }));

vi.mock('@main/core/ssh/lifecycle/production-ssh-connection-manager', () => ({
  sshConnectionManager: { connect: mocks.connect },
}));

vi.mock('./workspace-factory', () => ({
  createWorkspaceFactory: mocks.createWorkspaceFactory,
}));

vi.mock('./workspace-registry', () => ({
  workspaceRegistry: {
    acquire: mocks.acquire,
    teardown: mocks.teardown,
  },
}));

const task = { id: 'task-1', name: 'Task 1' };
const project = {
  projectId: 'project-1',
  repoPath: '/tmp/project',
  defaultWorkspaceType: { kind: 'local' },
  defaultWorkspaceMachine: { kind: 'local' },
  settings: {},
  gitRepository: {},
  gitRepositoryFetchService: {},
};

describe('teardownStoredWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connect.mockResolvedValue({ connectionId: 'persisted-connection' });
    mocks.teardown.mockResolvedValue(undefined);
  });

  it('omits activation hooks and runs the archive-specific teardown hook', async () => {
    const workspace = {
      id: 'workspace-1',
      type: 'local' as const,
      kind: 'worktree' as const,
      location: 'local' as const,
      sshConnectionId: null,
      path: '/tmp/worktree',
    };
    const created = {
      workspace: { id: 'workspace-1' },
      sshFilesRuntime: { kind: 'files' },
      onCreate: vi.fn(),
      onCreateSideEffect: vi.fn(),
      onArchive: vi.fn(),
      onDestroy: vi.fn(),
      onProviderDestroy: vi.fn(),
      onDetach: vi.fn(),
    };
    let teardownOnlyFactoryResult: unknown;
    mocks.createWorkspaceFactory.mockReturnValue(async () => created);
    mocks.acquire.mockImplementation(async (_id, _projectId, factory) => {
      teardownOnlyFactoryResult = await factory();
      return { workspace: created.workspace };
    });

    await expect(
      teardownStoredWorkspace({
        task,
        workspace,
        project: project as never,
        mode: 'archive',
      })
    ).resolves.toEqual({ success: true, data: true });

    expect(teardownOnlyFactoryResult).toEqual({
      workspace: created.workspace,
      sshFilesRuntime: created.sshFilesRuntime,
      onArchive: created.onArchive,
      onDestroy: created.onDestroy,
      onProviderDestroy: created.onProviderDestroy,
      onDetach: created.onDetach,
    });
    expect(mocks.teardown).toHaveBeenCalledWith('workspace-1', 'archive');
    expect(created.onCreate).not.toHaveBeenCalled();
    expect(created.onCreateSideEffect).not.toHaveBeenCalled();
  });

  it('uses the persisted SSH connection instead of the project default transport', async () => {
    const persistedProxy = { connectionId: 'persisted-connection' };
    const created = {
      workspace: { id: 'workspace-remote' },
      onArchive: vi.fn(),
      onDestroy: vi.fn(),
      onProviderDestroy: vi.fn(),
      onDetach: vi.fn(),
    };
    mocks.connect.mockResolvedValue(persistedProxy);
    mocks.createWorkspaceFactory.mockReturnValue(async () => created);
    mocks.acquire.mockImplementation(async (_id, _projectId, factory) => {
      await factory();
      return { workspace: created.workspace };
    });

    await expect(
      teardownStoredWorkspace({
        task,
        workspace: {
          id: 'workspace-remote',
          type: 'project-ssh',
          kind: 'worktree',
          location: 'remote',
          sshConnectionId: 'persisted-connection',
          path: '/remote/worktree',
        },
        project: {
          ...project,
          defaultWorkspaceType: { kind: 'ssh', connectionId: 'current-project-connection' },
          defaultWorkspaceMachine: { kind: 'ssh', connectionId: 'current-project-connection' },
        } as never,
        mode: 'terminate',
      })
    ).resolves.toEqual({ success: true, data: true });

    expect(mocks.connect).toHaveBeenCalledWith('persisted-connection');
    expect(mocks.createWorkspaceFactory).toHaveBeenCalledWith(
      'workspace-remote',
      { kind: 'ssh', proxy: persistedProxy, connectionId: 'persisted-connection' },
      expect.objectContaining({
        workspaceRuntime: {
          machine: { kind: 'ssh', connectionId: 'persisted-connection' },
          manager: {},
        },
      })
    );
  });

  it('selects provider-only termination when lifecycle teardown already completed', async () => {
    const created = {
      workspace: { id: 'workspace-1' },
      onArchive: vi.fn(),
      onDestroy: vi.fn(),
      onProviderDestroy: vi.fn(),
      onDetach: vi.fn(),
    };
    mocks.createWorkspaceFactory.mockReturnValue(async () => created);
    mocks.acquire.mockImplementation(async (_id, _projectId, factory) => {
      await factory();
      return { workspace: created.workspace };
    });

    await expect(
      teardownStoredWorkspace({
        task,
        workspace: {
          id: 'workspace-1',
          type: 'local',
          kind: 'worktree',
          location: 'local',
          sshConnectionId: null,
          path: '/tmp/worktree',
        },
        project: project as never,
        mode: 'terminate-provider',
      })
    ).resolves.toEqual({ success: true, data: true });

    expect(mocks.teardown).toHaveBeenCalledWith('workspace-1', 'terminate-provider');
  });

  it('treats an unprovisioned workspace as having no resource to teardown', async () => {
    await expect(
      teardownStoredWorkspace({
        task,
        workspace: {
          id: 'workspace-1',
          type: 'local',
          kind: 'worktree',
          location: 'local',
          sshConnectionId: null,
          path: null,
        },
        project: project as never,
        mode: 'terminate',
      })
    ).resolves.toEqual({ success: true, data: false });

    expect(mocks.createWorkspaceFactory).not.toHaveBeenCalled();
    expect(mocks.acquire).not.toHaveBeenCalled();
    expect(mocks.teardown).not.toHaveBeenCalled();
  });

  it('fails closed for a cold BYOI workspace', async () => {
    await expect(
      teardownStoredWorkspace({
        task,
        workspace: {
          id: 'workspace-2',
          type: 'byoi',
          kind: 'byoi',
          location: 'remote',
          sshConnectionId: null,
          path: '/remote/path',
        },
        project: project as never,
        mode: 'terminate',
      })
    ).resolves.toEqual({
      success: false,
      error: expect.objectContaining({
        type: 'error',
        message: expect.stringContaining('cold BYOI workspace'),
      }),
    });

    expect(mocks.createWorkspaceFactory).not.toHaveBeenCalled();
    expect(mocks.acquire).not.toHaveBeenCalled();
    expect(mocks.teardown).not.toHaveBeenCalled();
  });

  it('fails closed when a persisted remote workspace has no connection id', async () => {
    await expect(
      teardownStoredWorkspace({
        task,
        workspace: {
          id: 'workspace-remote',
          type: 'project-ssh',
          kind: 'worktree',
          location: 'remote',
          sshConnectionId: null,
          path: '/remote/worktree',
        },
        project: project as never,
        mode: 'terminate',
      })
    ).resolves.toEqual({
      success: false,
      error: expect.objectContaining({
        type: 'error',
        message: expect.stringContaining('persisted transport is unavailable'),
      }),
    });

    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.createWorkspaceFactory).not.toHaveBeenCalled();
  });
});
