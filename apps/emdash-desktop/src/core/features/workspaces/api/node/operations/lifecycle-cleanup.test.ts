import { hostRef, type HostRef } from '@emdash/core/primitives/host/api';
import type * as WorkspaceApi from '@emdash/core/runtimes/workspace/api';
import { err, ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LifecycleOperationRow } from '@core/services/operations/node/lifecycle-operation';
import {
  cleanLifecycleWorkspaceArtifacts,
  deactivateLifecycleWorkspace,
  teardownLifecycleWorkspace,
} from './lifecycle-cleanup';

const mocks = vi.hoisted(() => ({
  submitAndFollow: vi.fn(async (_client: unknown, _request: { workspace: { host: HostRef } }) =>
    ok({})
  ),
}));

vi.mock('@emdash/core/runtimes/workspace/api', async (importOriginal) => {
  const original = await importOriginal<typeof WorkspaceApi>();
  return {
    ...original,
    submitAndFollowWorkspaceOperation: mocks.submitAndFollow,
  };
});

describe('lifecycle workspace cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs remote cleanup operations through the remote runtime host', async () => {
    const remoteHost = hostRef('remote', 'ssh-1');
    const workspaceClient = {
      cleanArtifacts: { id: 'clean-artifacts' },
      deactivate: { id: 'deactivate' },
      teardown: { id: 'teardown' },
    };
    const client = vi.fn(async () => ok({ workspace: workspaceClient }));
    const dependencies = {
      projects: { getProject: vi.fn() },
      runtimes: { client },
      unregisterFileSearchRoot: vi.fn(),
    } as never;
    const operation = remoteOperation();
    const context = {
      projectPath: '/remote/repo',
      workspacePath: '/remote/worktree',
      workspaceKind: 'byoi' as const,
      preservePatterns: [],
    };

    await deactivateLifecycleWorkspace(dependencies, operation, context);
    await cleanLifecycleWorkspaceArtifacts(dependencies, operation, context);
    await teardownLifecycleWorkspace(dependencies, {} as never, operation, context);

    expect(client).toHaveBeenCalledTimes(3);
    expect(client).toHaveBeenNthCalledWith(1, remoteHost);
    expect(client).toHaveBeenNthCalledWith(2, remoteHost);
    expect(client).toHaveBeenNthCalledWith(3, remoteHost);
    expect(mocks.submitAndFollow.mock.calls.map((call) => call[1].workspace.host)).toEqual([
      remoteHost,
      remoteHost,
      remoteHost,
    ]);
    expect(mocks.submitAndFollow.mock.calls[2]?.[1]).toMatchObject({
      kind: 'teardown',
      params: { input: { force: false } },
    });
  });

  it('forces teardown only after the operation has been confirmed', async () => {
    const workspaceClient = {
      cleanArtifacts: { id: 'clean-artifacts' },
      deactivate: { id: 'deactivate' },
      teardown: { id: 'teardown' },
    };
    const dependencies = {
      projects: { getProject: vi.fn() },
      runtimes: { client: vi.fn(async () => ok({ workspace: workspaceClient })) },
      unregisterFileSearchRoot: vi.fn(),
    } as never;
    const operation = {
      ...remoteOperation(),
      confirmedAt: 1_000,
    };

    await teardownLifecycleWorkspace(dependencies, {} as never, operation, {
      projectPath: '/remote/repo',
      workspacePath: '/remote/worktree',
      workspaceKind: 'byoi' as const,
      preservePatterns: [],
    });

    expect(mocks.submitAndFollow).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: 'teardown',
        params: expect.objectContaining({
          input: expect.objectContaining({ force: true }),
        }),
      })
    );
  });

  it('preserves workspace-busy holders from runtime teardown errors', async () => {
    const workspaceClient = {
      cleanArtifacts: { id: 'clean-artifacts' },
      deactivate: { id: 'deactivate' },
      teardown: { id: 'teardown' },
    };
    const dependencies = {
      projects: { getProject: vi.fn() },
      runtimes: { client: vi.fn(async () => ok({ workspace: workspaceClient })) },
      unregisterFileSearchRoot: vi.fn(),
    } as never;
    mocks.submitAndFollow.mockResolvedValueOnce(
      err({
        type: 'workspace-busy',
        message: 'Workspace has active consumers or resources',
        holders: ['consumer:task-1'],
      }) as never
    );

    await expect(
      teardownLifecycleWorkspace(dependencies, {} as never, remoteOperation(), {
        projectPath: '/remote/repo',
        workspacePath: '/remote/worktree',
        workspaceKind: 'byoi' as const,
        preservePatterns: [],
      })
    ).rejects.toMatchObject({
      code: 'workspace-busy',
      holders: ['consumer:task-1'],
    });
  });
});

function remoteOperation(): LifecycleOperationRow {
  return {
    id: 'operation-1',
    kind: 'delete-workspace',
    status: 'running',
    projectId: 'project-1',
    taskId: null,
    workspaceId: null,
    entityKey: 'workspace-1',
    parentOperationId: null,
    parentForgetPolicy: null,
    initiatedBy: null,
    hostRef: 'ssh-1',
    payload: { version: '2', source: 'user', deleteWorktree: true },
    attempt: 1,
    confirmedAt: null,
    confirmationReason: null,
    error: null,
    createdAt: 0,
    finishedAt: null,
  };
}
