import { hostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { err, ok } from '@emdash/shared';
import type { LiveModelProvider, LiveSource } from '@emdash/wire';
import { describe, expect, it, vi } from 'vitest';
import type { workspacesWireContract } from '../api';
import type { WorkspacesIdentityResolver, WorkspacesRuntimeBroker } from '../api/runtime-adapter';
import { createWorkspacesWireController } from './wire-controller';

vi.mock('@core/features/tasks/node/task-provision-events', () => ({
  taskProvisionEvents: {
    on: vi.fn(() => () => {}),
  },
}));

vi.mock('@core/features/workspaces/api/node/workspace-bootstrap-service', () => ({
  runCloneRepositoryProvision: vi.fn(),
}));

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
      getWorkspaceRuntimeClient: vi.fn(),
      operations: {} as never,
      provisionTask: vi.fn(),
      onTaskProvisionProgress: () => () => {},
      onTaskWorkspaceReady: () => () => {},
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
      getWorkspaceRuntimeClient: vi.fn(),
      operations: {} as never,
      provisionTask: vi.fn(),
      onTaskProvisionProgress: () => () => {},
      onTaskWorkspaceReady: () => () => {},
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
