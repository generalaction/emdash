import { hostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { err, ok } from '@emdash/shared';
import type { LiveModelProvider, LiveSource } from '@emdash/wire';
import { describe, expect, it, vi } from 'vitest';
import type { workspacesWireContract } from '../api';
import type { WorkspacesIdentityResolver, WorkspacesRuntimeBroker } from '../api/runtime-adapter';
import { createWorkspacesWireController } from './wire-controller';

vi.mock('@core/services/app-db/node/schema', () => ({
  tasks: {},
  workspaces: {},
}));

describe('createWorkspacesWireController', () => {
  it('routes workspace ids through identity to the runtime client', async () => {
    const source = liveSource();
    const state = vi.fn(() => ({ asLiveSource: () => source }));
    const client = vi.fn(async () => ok({ workspace: { workspace: { state } } }));
    const resolve = vi.fn(async () => ({
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      host: LOCAL_HOST_REF,
      path: '/repo/worktree',
    }));
    const controller = createWorkspacesWireController({
      db: {} as never,
      operations: {} as never,
      provisionTask: vi.fn(),
      reprovisionWorkspace: vi.fn(),
      runtimes: { client } as unknown as WorkspacesRuntimeBroker,
      workspaceIdentity: {
        resolve,
        resolveProject: vi.fn(),
        findByPath: vi.fn(),
      } as WorkspacesIdentityResolver,
    });

    const runtime = controller.impl.runtime as LiveModelProvider<
      typeof workspacesWireContract.runtime
    >;
    const resolved = runtime.resolveState({ workspaceId: 'workspace-1' }, 'state');

    await expect(resolved).resolves.toBe(source);
    expect(resolve).toHaveBeenCalledWith('workspace-1');
    expect(client).toHaveBeenCalledWith(LOCAL_HOST_REF);
    expect(state).toHaveBeenCalledOnce();

    await controller.dispose();
  });

  it('returns RuntimeResolveError from fallible workspace procedures', async () => {
    const remoteHost = hostRef('remote', 'ssh-1');
    const resolveError = {
      type: 'host-unavailable' as const,
      host: remoteHost,
      message: 'Remote runtime sessions are not enabled',
    };
    const controller = createWorkspacesWireController({
      db: {} as never,
      operations: {} as never,
      provisionTask: vi.fn(),
      reprovisionWorkspace: vi.fn(),
      runtimes: {
        client: async () => err(resolveError),
      } as unknown as WorkspacesRuntimeBroker,
      workspaceIdentity: {
        resolve: vi.fn(async () => ({
          workspaceId: 'workspace-1',
          projectId: 'project-1',
          host: remoteHost,
          path: '/repo/worktree',
        })),
        resolveProject: vi.fn(),
        findByPath: vi.fn(),
      } as WorkspacesIdentityResolver,
    });

    await expect(
      controller.impl.reconcile?.({ workspaceId: 'workspace-1' }, {} as never)
    ).resolves.toEqual(err(resolveError));
    await controller.dispose();
  });

  it('activates a task without publishing a bootstrap model', async () => {
    const provisionTask = vi.fn(async () =>
      ok({
        workspaceId: 'workspace-1',
        path: '/repo/worktree',
      })
    );
    const controller = createWorkspacesWireController({
      db: {} as never,
      operations: {} as never,
      provisionTask,
      reprovisionWorkspace: vi.fn(),
      runtimes: { client: vi.fn() } as unknown as WorkspacesRuntimeBroker,
      workspaceIdentity: {
        resolve: vi.fn(),
        resolveProject: vi.fn(),
        findByPath: vi.fn(),
      } as WorkspacesIdentityResolver,
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

    expect(provisionTask).toHaveBeenCalledWith('task-1', expect.any(AbortSignal), undefined);
    await controller.dispose();
  });
});

function liveSource(): LiveSource {
  return {
    snapshot: async () => ({
      generation: 1,
      sequence: 0,
      timestamp: 0,
      data: {
        workspace: {
          host: LOCAL_HOST_REF,
          path: {
            root: { kind: 'posix' },
            segments: ['repo', 'worktree'],
            unicodeNormalization: 'preserve',
          },
        },
        topology: { kind: 'directory' },
        operation: { status: 'idle' },
        consumers: [],
        activity: { resources: [] },
      },
    }),
    subscribe: () => () => {},
  };
}
