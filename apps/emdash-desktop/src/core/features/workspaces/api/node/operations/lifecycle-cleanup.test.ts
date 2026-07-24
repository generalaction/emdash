import { hostRef, type HostRef } from '@emdash/core/primitives/host/api';
import { ok } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
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
    hostRef: 'ssh-1',
    payload: { version: '1', source: 'user', deleteWorktree: true },
    attempt: 1,
    error: null,
    createdAt: 0,
    finishedAt: null,
  };
}
