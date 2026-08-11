import { err, ok } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  buildTaskProviders,
  resolveTaskEnv,
} from '@core/features/workspaces/api/node/workspace-factory';

describe('buildTaskProviders', () => {
  it('constructs providers for a remote host with its injected runtime clients', async () => {
    const conversations = {};
    const files = { client: {}, root: {} } as never;
    const tuiAgents = {};
    const options = {
      host: { type: 'remote' as const, id: 'ssh-1' },
      files,
      tuiAgents: tuiAgents as never,
      projectId: 'project-1',
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      taskPath: '/remote/worktree',
      tmuxEnabled: false,
      taskEnvVars: {},
    };
    const createConversationProvider = vi.fn(() => conversations as never);

    const result = await buildTaskProviders(options, createConversationProvider);

    expect(result).toEqual({
      success: true,
      data: { conversations },
    });
    expect(createConversationProvider).toHaveBeenCalledWith(options);
  });
});

describe('resolveTaskEnv', () => {
  it('reads shell setup from registry config and tmux from DB placement settings', async () => {
    const getProjectConfig = vi.fn(async () =>
      ok({
        resolved: {
          preservePatterns: { value: [], from: 'built-in' as const },
          shellSetup: { value: 'source .workspace-env', from: 'team' as const },
          autoRunSetup: { value: true, from: 'built-in' as const },
          autoRunRun: { value: false, from: 'built-in' as const },
        },
      })
    );
    const getStoredPlacementSettings = vi.fn(async () => ({ tmux: true }));
    const get = vi.fn(() => {
      throw new Error('merged project settings must not be read');
    });
    const settings = {
      get,
      getStoredPlacementSettings,
      getStoredGitSettings: vi.fn(async () => ({
        defaultBranch: { remote: null, branch: 'main' },
      })),
      getWorktreeRootContext: vi.fn(async () => ({
        builtInWorktreeRoot: '/tmp/worktrees',
      })),
    } as never;

    const result = await resolveTaskEnv(
      { id: 'task-1', name: 'Task one' },
      {
        id: 'workspace-1',
        path: '/repo/worktree',
        workspaceRegistry: { getProjectConfig, createWorkspace: vi.fn() },
      } as never,
      '/repo',
      settings,
      {
        get: vi.fn(async () => ({ remotes: [], localBranches: ['main'] })),
        dispose: vi.fn(),
      }
    );

    expect(result).toMatchObject({
      success: true,
      data: {
        tmuxEnabled: true,
        shellSetup: 'source .workspace-env',
        taskEnvVars: { EMDASH_DEFAULT_BRANCH: 'main' },
      },
    });
    expect(getProjectConfig).toHaveBeenCalledWith({ workspaceId: 'workspace-1' });
    expect(getStoredPlacementSettings).toHaveBeenCalledOnce();
    expect(get).not.toHaveBeenCalled();
  });

  it('registers a missing workspace before retrying project config resolution', async () => {
    const getProjectConfig = vi
      .fn()
      .mockResolvedValueOnce(err({ type: 'workspace-not-found', workspaceId: 'workspace-1' }))
      .mockResolvedValueOnce(
        ok({
          resolved: {
            shellSetup: { value: 'source .workspace-env', from: 'team' as const },
          },
        })
      );
    const createWorkspace = vi.fn(async () => ok({} as never));
    const settings = {
      getStoredPlacementSettings: vi.fn(async () => ({ tmux: false })),
      getStoredGitSettings: vi.fn(async () => ({})),
      getWorktreeRootContext: vi.fn(async () => ({
        builtInWorktreeRoot: '/tmp/worktrees',
      })),
    } as never;

    const result = await resolveTaskEnv(
      { id: 'task-1', name: 'Task one' },
      {
        id: 'workspace-1',
        path: '/repo/worktree',
        workspaceRegistry: { getProjectConfig, createWorkspace },
      } as never,
      '/repo',
      settings,
      {
        get: vi.fn(async () => ({ remotes: [], localBranches: [] })),
        dispose: vi.fn(),
      }
    );

    expect(result.success).toBe(true);
    expect(createWorkspace).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      path: '/repo/worktree',
    });
    expect(getProjectConfig).toHaveBeenCalledTimes(2);
  });

  it('returns a failed config retry instead of throwing', async () => {
    const getProjectConfig = vi.fn(async () =>
      err({ type: 'workspace-not-found' as const, workspaceId: 'workspace-1' })
    );
    const createWorkspace = vi.fn(async () => ok({} as never));

    const result = await resolveTaskEnv(
      { id: 'task-1', name: 'Task one' },
      {
        id: 'workspace-1',
        path: '/repo/worktree',
        workspaceRegistry: { getProjectConfig, createWorkspace },
      } as never,
      '/repo',
      {
        getStoredPlacementSettings: vi.fn(async () => ({})),
        getStoredGitSettings: vi.fn(async () => ({})),
        getWorktreeRootContext: vi.fn(async () => ({
          builtInWorktreeRoot: '/tmp/worktrees',
        })),
      } as never,
      {
        get: vi.fn(async () => ({ remotes: [], localBranches: [] })),
        dispose: vi.fn(),
      }
    );

    expect(result).toEqual({
      success: false,
      error: {
        type: 'setup-failed',
        stepKind: 'resolve-project-config',
        stepErrorType: 'workspace-not-found',
        message: 'Could not resolve project config for workspace workspace-1 (workspace-not-found)',
      },
    });
    expect(getProjectConfig).toHaveBeenCalledTimes(2);
  });
});
