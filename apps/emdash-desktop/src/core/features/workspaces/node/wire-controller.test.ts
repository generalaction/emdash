import { ok } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import { createWorkspacesWireController } from './wire-controller';

vi.mock('@core/services/app-db/node/schema', () => ({
  tasks: {},
  workspaces: {},
  conversations: {},
}));

describe('createWorkspacesWireController', () => {
  const attachedProjects = {
    requireAttached: vi.fn(() => ({ success: true as const, data: {} as never })),
  };

  it('activates a task through the provision job', async () => {
    const provisionTask = vi.fn(async () =>
      ok({
        workspaceId: 'workspace-1',
        path: '/repo/worktree',
      })
    );
    const controller = createWorkspacesWireController({
      db: {} as never,
      projects: attachedProjects,
      runtimes: {} as never,
      provisionTask,
      reprovisionWorkspace: vi.fn(),
    });

    await expect(
      (
        controller.impl.provision as unknown as {
          run(
            input: { workspaceId: string; taskId?: string },
            ctx: { progress: (progress: unknown) => void; signal: AbortSignal }
          ): Promise<unknown>;
        }
      ).run({ workspaceId: 'workspace-1', taskId: 'task-1' }, {
        progress: vi.fn(),
        signal: new AbortController().signal,
      } as never)
    ).resolves.toEqual(
      ok({
        workspaceId: 'workspace-1',
        path: '/repo/worktree',
      })
    );

    expect(provisionTask).toHaveBeenCalledWith('task-1', expect.any(AbortSignal));
    await controller.dispose();
  });

  it('routes reprovision variants through the reprovision dependency', async () => {
    const reprovisionWorkspace = vi.fn(async () => ok({}));
    const controller = createWorkspacesWireController({
      db: {} as never,
      projects: attachedProjects,
      runtimes: {} as never,
      provisionTask: vi.fn(),
      reprovisionWorkspace: reprovisionWorkspace as never,
    });

    await controller.impl.reprovision?.({ workspaceId: 'workspace-1' }, {} as never);
    expect(reprovisionWorkspace).toHaveBeenCalledWith('workspace-1');

    await controller.impl.removeAndReprovision?.({ workspaceId: 'workspace-1' }, {} as never);
    expect(reprovisionWorkspace).toHaveBeenCalledWith('workspace-1', { removeFirst: true });

    await controller.dispose();
  });

  it('refuses Host-backed mutations when Project attachment is unavailable', async () => {
    const runtimeClient = vi.fn();
    const controller = createWorkspacesWireController({
      db: {} as never,
      projects: {
        requireAttached: () => ({
          success: false,
          error: {
            type: 'attachment-unavailable',
            host: {} as never,
            phase: 'waiting',
          },
        }),
      },
      runtimes: { client: runtimeClient } as never,
      provisionTask: vi.fn(),
      reprovisionWorkspace: vi.fn(),
    });

    const result = await controller.impl.archive?.(
      {
        projectId: 'project-1',
        workspaceId: 'workspace-1',
        workspacePath: '/repo/worktree',
      },
      {} as never
    );
    expect(result).toEqual({
      success: false,
      error: {
        type: 'project-unavailable',
        message: 'This action requires live Project access.',
      },
    });
    expect(runtimeClient).not.toHaveBeenCalled();
    await controller.dispose();
  });
});
