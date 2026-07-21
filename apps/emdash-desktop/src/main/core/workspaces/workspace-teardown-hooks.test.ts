import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from './workspace';
import { createWorkspaceTeardownHooks } from './workspace-teardown-hooks';

const mocks = vi.hoisted(() => ({
  getEffectiveTaskSettings: vi.fn(),
  onWorkspaceDeactivated: vi.fn(),
  runLifecycleScriptWithPolicy: vi.fn(),
  stopForWorkspace: vi.fn(),
}));

vi.mock('@main/core/preview-servers/preview-server-service-instance', () => ({
  previewServerService: { stopForWorkspace: mocks.stopForWorkspace },
}));

vi.mock('@main/core/search/workspace-file-index-service', () => ({
  workspaceFileIndexService: { onWorkspaceDeactivated: mocks.onWorkspaceDeactivated },
}));

vi.mock('@main/core/terminals/lifecycle-script-coordinator', () => ({
  runLifecycleScriptWithPolicy: mocks.runLifecycleScriptWithPolicy,
}));

vi.mock('../projects/settings/effective-task-settings', () => ({
  getEffectiveTaskSettings: mocks.getEffectiveTaskSettings,
}));

vi.mock('../tasks/provision-task-error', () => ({
  TEARDOWN_SCRIPT_WAIT_MS: 30_000,
}));

describe('createWorkspaceTeardownHooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEffectiveTaskSettings.mockResolvedValue({
      scripts: { teardown: 'pnpm cleanup' },
      shellSetup: 'export TASK_SHELL=1',
    });
    mocks.runLifecycleScriptWithPolicy.mockResolvedValue({ kind: 'succeeded' });
    mocks.stopForWorkspace.mockResolvedValue(undefined);
  });

  it('archive runs lifecycle teardown and provider detach without provider destroy', async () => {
    const workspace = {
      id: 'workspace-1',
      configPath: '/tmp/worktree/.emdash.json',
      fileSystem: {},
    } as Workspace;
    const settings = { get: vi.fn(async () => ({ shellSetup: 'project shell' })) };
    const onDetach = vi.fn(async () => {});
    const onDestroy = vi.fn(async () => {});
    const fetchService = { stop: vi.fn() };
    const hooks = createWorkspaceTeardownHooks({
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      taskId: 'task-1',
      settings: settings as never,
      ownsFetchService: true,
      gitRepositoryFetchService: fetchService as never,
      extraHooks: { onDetach, onDestroy },
      logPrefix: 'test',
    });

    await hooks.onArchive(workspace);

    expect(mocks.runLifecycleScriptWithPolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace,
        projectId: 'project-1',
        taskId: 'task-1',
        workspaceId: 'workspace-1',
        type: 'teardown',
        script: 'pnpm cleanup',
        shellSetup: 'export TASK_SHELL=1',
      })
    );
    expect(onDetach).toHaveBeenCalledWith(workspace);
    expect(onDestroy).not.toHaveBeenCalled();
    expect(fetchService.stop).toHaveBeenCalledTimes(1);
    expect(mocks.onWorkspaceDeactivated).toHaveBeenCalledWith('workspace-1');
  });

  it('archive then provider-only termination runs lifecycle teardown exactly once', async () => {
    const workspace = {
      id: 'workspace-1',
      configPath: '/tmp/worktree/.emdash.json',
      fileSystem: {},
    } as Workspace;
    const onDetach = vi.fn(async () => {});
    const onDestroy = vi.fn(async () => {});
    const hooks = createWorkspaceTeardownHooks({
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      taskId: 'task-1',
      settings: { get: vi.fn(async () => ({ shellSetup: 'project shell' })) } as never,
      ownsFetchService: true,
      gitRepositoryFetchService: { stop: vi.fn() } as never,
      extraHooks: { onDetach, onDestroy },
      logPrefix: 'test',
    });

    await hooks.onArchive(workspace);
    await hooks.onProviderDestroy(workspace);

    expect(onDetach).toHaveBeenCalledWith(workspace);
    expect(onDestroy).toHaveBeenCalledWith(workspace);
    expect(mocks.runLifecycleScriptWithPolicy).toHaveBeenCalledTimes(1);
    expect(mocks.stopForWorkspace).toHaveBeenCalledTimes(1);
    expect(mocks.onWorkspaceDeactivated).toHaveBeenCalledTimes(1);
  });
});
