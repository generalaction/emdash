import { hostRef, type HostRef } from '@emdash/core/primitives/host/api';
import { err, ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LifecycleOperationRow } from '@core/services/app-db/node/schema';
import {
  cleanLifecycleWorkspaceArtifacts,
  deactivateLifecycleWorkspace,
  teardownLifecycleWorkspace,
} from './lifecycle-cleanup';

const mocks = vi.hoisted(() => ({
  runRuntimeLiveJob: vi.fn(
    async (_definition: unknown, _handle: unknown, _input: { workspace: { host: HostRef } }) =>
      ok({})
  ),
}));

vi.mock('@core/services/runtime-clients/node/live-job', () => ({
  runRuntimeLiveJob: mocks.runRuntimeLiveJob,
}));

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
    expect(mocks.runRuntimeLiveJob.mock.calls.map((call) => call[2].workspace.host)).toEqual([
      remoteHost,
      remoteHost,
      remoteHost,
    ]);
    expect(mocks.runRuntimeLiveJob.mock.calls[2]?.[2]).toMatchObject({ force: false });
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
      payload: { ...remoteOperation().payload, confirmedAt: 1_000 },
    };

    await teardownLifecycleWorkspace(dependencies, {} as never, operation, {
      projectPath: '/remote/repo',
      workspacePath: '/remote/worktree',
      workspaceKind: 'byoi' as const,
      preservePatterns: [],
    });

    expect(mocks.runRuntimeLiveJob).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ force: true })
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
    mocks.runRuntimeLiveJob.mockResolvedValueOnce(
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
    initiatedBy: null,
    hostRef: 'ssh-1',
    payload: { version: '1', source: 'user', deleteWorktree: true },
    attempt: 1,
    error: null,
    createdAt: 0,
    finishedAt: null,
  };
}
