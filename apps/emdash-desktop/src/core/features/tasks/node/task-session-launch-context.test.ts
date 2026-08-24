import { ok } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import { TaskSessionLaunchContextResolver } from '../api/node/task-session-launch-context';

describe('TaskSessionLaunchContextResolver', () => {
  it('reads mutable launch policy from its authorities on every resolution', async () => {
    let taskName = 'Old task';
    let tmux = false;
    let shellSetup = 'source old-profile';
    let defaultBranch = 'main';
    const identity = {
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      host: { type: 'local', id: 'local' } as const,
      path: '/repo/worktree',
    };
    const select = vi.fn(() =>
      selecting({
        id: 'task-1',
        projectId: 'project-1',
        workspaceId: 'workspace-1',
        name: taskName,
      })
    );
    const getProjectConfig = vi.fn(async () =>
      ok({
        resolved: {
          shellSetup: { value: shellSetup, from: 'team' as const },
        },
      })
    );
    const settings = {
      resolveTmux: vi.fn(async () => ({
        value: tmux,
        provenance: { kind: 'set' as const },
      })),
      getStoredGitSettings: vi.fn(async () => ({
        defaultBranch: { remote: null, branch: defaultBranch },
      })),
      getPlacementContext: vi.fn(async () => ({
        hostWorktreeRoot: null,
        builtInWorktreeRoot: '/tmp/worktrees',
        homeDirectory: '/tmp',
        hostTmux: null,
        appDefaultTmux: false,
      })),
    };
    const repoFacts = {
      get: vi.fn(async () => ({ remotes: [], localBranches: [defaultBranch] })),
    };
    const resolver = new TaskSessionLaunchContextResolver({
      db: { select } as never,
      projects: {
        requireAttached: vi.fn(() =>
          ok({
            repoPath: '/repo',
            settings,
            repoFacts,
          } as never)
        ),
      },
      runtimes: {
        client: vi.fn(async () => ok({ workspaceRegistry: { getProjectConfig } } as never)),
      },
      workspaceIdentity: { resolve: vi.fn(async () => identity) },
    });
    const source = resolver.bind({
      projectId: 'project-1',
      taskId: 'task-1',
      workspaceId: 'workspace-1',
    });

    const first = await source.resolve();

    taskName = 'New task';
    tmux = true;
    shellSetup = 'source new-profile';
    defaultBranch = 'trunk';
    const second = await source.resolve();

    expect(first).toMatchObject({
      success: true,
      data: {
        tmux: false,
        shellSetup: 'source old-profile',
        env: {
          EMDASH_TASK_NAME: 'old-task',
          EMDASH_DEFAULT_BRANCH: 'main',
        },
      },
    });
    expect(second).toMatchObject({
      success: true,
      data: {
        tmux: true,
        shellSetup: 'source new-profile',
        env: {
          EMDASH_TASK_NAME: 'new-task',
          EMDASH_DEFAULT_BRANCH: 'trunk',
        },
      },
    });
    expect(select).toHaveBeenCalledTimes(2);
    expect(getProjectConfig).toHaveBeenCalledTimes(2);
    expect(settings.resolveTmux).toHaveBeenCalledTimes(2);
  });

  it('does not let a task-bound source silently follow a replacement workspace', async () => {
    const requireAttached = vi.fn();
    const resolver = new TaskSessionLaunchContextResolver({
      db: {
        select: vi.fn(() =>
          selecting({
            id: 'task-1',
            projectId: 'project-1',
            workspaceId: 'workspace-2',
            name: 'Task',
          })
        ),
      } as never,
      projects: { requireAttached },
      runtimes: { client: vi.fn() },
      workspaceIdentity: { resolve: vi.fn() },
    });
    const source = resolver.bind({
      projectId: 'project-1',
      taskId: 'task-1',
      workspaceId: 'workspace-1',
    });

    await expect(source.resolve()).resolves.toEqual({
      success: false,
      error: {
        type: 'missing-workspace',
        message: 'Task task-1 is not bound to workspace workspace-1',
      },
    });
    expect(requireAttached).not.toHaveBeenCalled();
  });
});

function selecting<T>(row: T) {
  return {
    from: () => ({
      where: () => ({
        limit: async () => [row],
      }),
    }),
  };
}
