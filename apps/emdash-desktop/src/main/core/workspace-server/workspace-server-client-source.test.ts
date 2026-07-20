import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { hostFileRef, parseAbsolute, type HostFileRef } from '@emdash/core/primitives/path/api';
import { workspaceContract } from '@emdash/core/runtimes/workspace/api';
import type { WorkspaceTopology } from '@emdash/core/runtimes/workspace/api';
import {
  createWorkspaceController,
  WorkspaceRuntime,
  type WorkspaceProvisioner,
} from '@emdash/core/runtimes/workspace/node';
import { PROTOCOL_VERSION, workspaceWireContract } from '@emdash/core/workspace-server';
import { ok, type Result } from '@emdash/shared';
import { retrySchedules } from '@emdash/shared/scheduling';
import { deferred, waitFor } from '@emdash/shared/testing';
import { createLiveJobReplica, type ContractClient } from '@emdash/wire';
import { createTestWire } from '@emdash/wire/testing';
import { describe, expect, it } from 'vitest';
import { createTestWorkspaceWireController } from '../../../../../workspace-server/src/testing/controller';
import {
  serveSocket,
  type SocketServeHandle,
} from '../../../../../workspace-server/src/wire/serve-socket';
import { openLocalWorkspaceServerTransport } from './local-socket-transport';
import {
  createWorkspaceServerClientSource,
  type LocalWorkspaceServerTarget,
  type WorkspaceServerProtocolError,
  workspaceServerTargetKey,
} from './workspace-server-client-source';

describe('workspace server client source', () => {
  it('keys SSH connections by connection id and socket path', () => {
    expect(
      workspaceServerTargetKey({
        kind: 'ssh',
        sshConnectionId: 'ssh-one',
        socketPath: '/run/workspace.sock',
      })
    ).not.toBe(
      workspaceServerTargetKey({
        kind: 'ssh',
        sshConnectionId: 'ssh-two',
        socketPath: '/run/workspace.sock',
      })
    );
    expect(
      workspaceServerTargetKey({
        kind: 'ssh',
        sshConnectionId: 'ssh-one',
        socketPath: '/run/other.sock',
      })
    ).not.toBe(
      workspaceServerTargetKey({
        kind: 'ssh',
        sshConnectionId: 'ssh-one',
        socketPath: '/run/workspace.sock',
      })
    );
  });

  it('shares one initialized local daemon connection per target', async () => {
    const testDirectory = await mkdtemp(join(tmpdir(), 'emdash-workspace-client-'));
    const target = localTarget(join(testDirectory, 'workspace.sock'));
    const server = await serveSocket(
      createTestWorkspaceWireController({}, { daemonId: 'daemon-one', appVersion: '1.2.3' }),
      { socketPath: target.socketPath }
    );
    let openCount = 0;
    const source = createWorkspaceServerClientSource({
      idleTtlMs: 0,
      retrySchedule: retrySchedules.sequence([5], { repeatLast: true }),
      openTransport: async (nextTarget) => {
        openCount += 1;
        if (nextTarget.kind !== 'local-socket') throw new Error('expected local target');
        return await openLocalWorkspaceServerTransport(nextTarget);
      },
    });
    const firstLease = source.acquire(target);
    const secondLease = source.acquire(target);

    try {
      const [first, second] = await Promise.all([firstLease.ready(), secondLease.ready()]);

      expect(first).toBe(second);
      expect(openCount).toBe(1);
      expect(first.currentHandshake()).toMatchObject({
        protocolVersion: PROTOCOL_VERSION,
        server: { appVersion: '1.2.3', daemonId: 'daemon-one' },
      });
      await expect(first.client.health(undefined)).resolves.toMatchObject({ status: 'ok' });
    } finally {
      await firstLease.release();
      await secondLease.release();
      await source.dispose();
      await server.dispose();
      await rm(testDirectory, { recursive: true, force: true });
    }
  });

  it('treats protocol incompatibility as terminal and does not reconnect', async () => {
    const testDirectory = await mkdtemp(join(tmpdir(), 'emdash-workspace-client-'));
    const target = localTarget(join(testDirectory, 'workspace.sock'));
    const server = await serveSocket(createTestWorkspaceWireController(), {
      socketPath: target.socketPath,
    });
    let openCount = 0;
    const source = createWorkspaceServerClientSource({
      idleTtlMs: 0,
      protocolVersion: '999.0.0',
      retrySchedule: retrySchedules.sequence([1], { repeatLast: true }),
      openTransport: async (nextTarget) => {
        openCount += 1;
        if (nextTarget.kind !== 'local-socket') throw new Error('expected local target');
        return await openLocalWorkspaceServerTransport(nextTarget);
      },
    });
    const lease = source.acquire(target);

    try {
      await expect(lease.ready()).rejects.toMatchObject({
        name: 'WorkspaceServerProtocolError',
        details: {
          code: 'protocol-incompatible',
          action: 'upgrade-server',
          clientProtocolVersion: '999.0.0',
          serverProtocolVersion: PROTOCOL_VERSION,
        },
      } satisfies Partial<WorkspaceServerProtocolError>);
      expect(openCount).toBe(1);
      expect(source.peek(target)).toBeUndefined();
    } finally {
      await lease.release();
      await source.dispose();
      await server.dispose();
      await rm(testDirectory, { recursive: true, force: true });
    }
  });

  it('reconnects live state and a running LiveJob across socket daemon restarts', async () => {
    const testDirectory = await mkdtemp(join(tmpdir(), 'emdash-workspace-client-'));
    const target = localTarget(join(testDirectory, 'workspace.sock'));
    const workspace = workspaceFromNativePath(testDirectory);
    const provisioner = new BlockingWorkspaceProvisioner();
    const runtime = new WorkspaceRuntime({ provisioner });
    const runtimeWire = createTestWire(
      workspaceContract,
      createWorkspaceController(runtime, { validate: 'full' })
    );
    const source = createWorkspaceServerClientSource({
      idleTtlMs: 0,
      retrySchedule: retrySchedules.sequence([5], { repeatLast: true }),
    });
    const lease = source.acquire(target);
    let server: SocketServeHandle | undefined;
    let detachState: (() => void) | undefined;
    let disposeJobs: (() => Promise<void>) | undefined;
    let releaseJob: (() => Promise<void>) | undefined;

    try {
      server = await serveWorkspaceDaemon(target.socketPath, runtimeWire.client, 'daemon-one');
      const workspaceServer = await lease.ready();
      expect(workspaceServer.currentHandshake()?.server.daemonId).toBe('daemon-one');

      const reconciled = await workspaceServer.client.workspace.reconcile({ workspace });
      expect(reconciled.success).toBe(true);
      const state = workspaceServer.client.workspace.workspace.state(workspace, 'state');
      await expect(state.snapshot()).resolves.toMatchObject({
        data: { topology: { kind: 'directory' } },
      });
      let reattachCount = 0;
      detachState = await state.attach(() => {}, {
        onReattach: () => {
          reattachCount += 1;
        },
      });

      const blockedCall = provisioner.blockNextInspect();
      const pendingReconcile = workspaceServer.client.workspace
        .reconcile({ workspace })
        .catch((error: unknown) => error);
      await blockedCall.started.promise;
      const firstDisconnect = deferred<void>();
      const stopWatchingFirstDisconnect = workspaceServer.connection.onDisconnect(() =>
        firstDisconnect.resolve()
      );
      await server.dispose();
      server = undefined;
      await firstDisconnect.promise;
      stopWatchingFirstDisconnect();
      await expect(pendingReconcile).resolves.toMatchObject({ code: 'DISCONNECTED' });
      const firstReplacement = workspaceServer.ready();
      blockedCall.release.resolve();
      await waitFor(
        () => runtime.host.get(workspace)?.states.state.snapshot().data.operation.kind === 'idle'
      );

      server = await serveWorkspaceDaemon(target.socketPath, runtimeWire.client, 'daemon-two');
      await expect(firstReplacement).resolves.toMatchObject({
        server: { daemonId: 'daemon-two' },
      });
      await waitFor(() => reattachCount === 1);

      const blockedJob = provisioner.blockNextInspect();
      const jobs = createLiveJobReplica(
        workspaceWireContract.workspace.provision,
        workspaceServer.client.workspace.provision
      );
      disposeJobs = () => jobs.dispose();
      const jobLease = await jobs.start({ workspace });
      releaseJob = jobLease.release;
      const job = await jobLease.ready();
      await blockedJob.started.promise;

      await server.dispose();
      server = undefined;
      const secondReplacement = workspaceServer.ready();
      server = await serveWorkspaceDaemon(target.socketPath, runtimeWire.client, 'daemon-three');
      await expect(secondReplacement).resolves.toMatchObject({
        server: { daemonId: 'daemon-three' },
      });
      await waitFor(() => reattachCount === 2);

      blockedJob.release.resolve();
      await expect(job.result).resolves.toMatchObject({
        workspace,
        topology: { kind: 'directory' },
      });
    } finally {
      detachState?.();
      await releaseJob?.();
      await disposeJobs?.();
      await lease.release();
      await source.dispose();
      await server?.dispose();
      await runtimeWire.dispose();
      runtime.dispose();
      await rm(testDirectory, { recursive: true, force: true });
    }
  });
});

function localTarget(socketPath: string): LocalWorkspaceServerTarget {
  return { kind: 'local-socket', socketPath };
}

function workspaceFromNativePath(nativePath: string): HostFileRef {
  const parsed = parseAbsolute(nativePath);
  if (!parsed.success) throw new Error(parsed.error.message);
  return hostFileRef(LOCAL_HOST_REF, parsed.data);
}

async function serveWorkspaceDaemon(
  socketPath: string,
  workspace: ContractClient<typeof workspaceContract>,
  daemonId: string
): Promise<SocketServeHandle> {
  return await serveSocket(createTestWorkspaceWireController({ workspace }, { daemonId }), {
    socketPath,
  });
}

type InspectBlock = {
  started: ReturnType<typeof deferred<void>>;
  release: ReturnType<typeof deferred<void>>;
};

class BlockingWorkspaceProvisioner implements WorkspaceProvisioner {
  private nextBlock: InspectBlock | undefined;

  blockNextInspect(): InspectBlock {
    const block = { started: deferred<void>(), release: deferred<void>() };
    this.nextBlock = block;
    return block;
  }

  async inspect(): Promise<Result<WorkspaceTopology, never>> {
    const block = this.nextBlock;
    this.nextBlock = undefined;
    if (block) {
      block.started.resolve();
      await block.release.promise;
    }
    return ok({ kind: 'directory' });
  }

  async provision(): Promise<Result<WorkspaceTopology, never>> {
    return ok({ kind: 'directory' });
  }

  async convert(): Promise<Result<WorkspaceTopology, never>> {
    return ok({ kind: 'directory' });
  }

  async remove(): Promise<Result<void, never>> {
    return ok(undefined);
  }
}
