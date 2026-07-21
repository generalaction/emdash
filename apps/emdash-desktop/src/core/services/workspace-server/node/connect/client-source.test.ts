import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROTOCOL_VERSION } from '@emdash/core/workspace-server';
import { retrySchedules } from '@emdash/shared/scheduling';
import { waitFor } from '@emdash/shared/testing';
import { describe, expect, it, vi } from 'vitest';
import { createTestWorkspaceWireController } from '../../../../../../../workspace-server/src/testing/controller';
import { serveSocket } from '../../../../../../../workspace-server/src/wire/serve-socket';
import { workspaceServerTargetKey, type LocalWorkspaceServerTarget } from '../targets';
import {
  createWorkspaceServerClientSource,
  workspaceServerReconnectSchedule,
} from './client-source';
import { openLocalWorkspaceServerTransport } from './local-socket-transport';

describe('workspace server client source', () => {
  it('keys SSH targets by connection id and socket path', () => {
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
  });

  it('shares an initialized client and reinitializes after a daemon restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'emdash-workspace-client-'));
    const target = localTarget(join(directory, 'workspace.sock'));
    let server = await serveSocket(
      createTestWorkspaceWireController({}, { daemonId: 'daemon-one', appVersion: '1.2.3' }),
      { socketPath: target.socketPath }
    );
    const source = createWorkspaceServerClientSource({
      idleTtlMs: 0,
      retrySchedule: retrySchedules.sequence([5], { repeatLast: true }),
    });
    const firstLease = source.acquire(target);
    const secondLease = source.acquire(target);

    try {
      const [first, second] = await Promise.all([firstLease.ready(), secondLease.ready()]);
      expect(first).toBe(second);
      expect(first.currentHandshake()).toMatchObject({
        protocolVersion: PROTOCOL_VERSION,
        server: { daemonId: 'daemon-one', appVersion: '1.2.3' },
      });

      await server.dispose();
      const replacement = first.ready();
      server = await serveSocket(
        createTestWorkspaceWireController({}, { daemonId: 'daemon-two' }),
        { socketPath: target.socketPath }
      );

      await expect(replacement).resolves.toMatchObject({ server: { daemonId: 'daemon-two' } });
    } finally {
      await firstLease.release();
      await secondLease.release();
      await source.dispose();
      await server.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('treats protocol incompatibility as terminal', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'emdash-workspace-client-'));
    const target = localTarget(join(directory, 'workspace.sock'));
    const server = await serveSocket(createTestWorkspaceWireController(), {
      socketPath: target.socketPath,
    });
    const source = createWorkspaceServerClientSource({
      idleTtlMs: 0,
      protocolVersion: '999.0.0',
      retrySchedule: retrySchedules.sequence([1], { repeatLast: true }),
    });
    const onTerminalError = vi.fn();
    source.onTerminalError(onTerminalError);
    const lease = source.acquire(target);

    try {
      await expect(lease.ready()).rejects.toMatchObject({
        name: 'WorkspaceServerProtocolError',
        details: { action: 'upgrade-server' },
      });
      expect(onTerminalError).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'WorkspaceServerProtocolError' }),
        target
      );
      expect(source.peek(target)).toBeUndefined();
    } finally {
      await lease.release();
      await source.dispose();
      await server.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('survives several delayed reconnect attempts without terminal invalidation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'emdash-workspace-client-'));
    const target = localTarget(join(directory, 'workspace.sock'));
    let server = await serveSocket(
      createTestWorkspaceWireController({}, { daemonId: 'delayed-one' }),
      { socketPath: target.socketPath }
    );
    let openCount = 0;
    const onTerminalError = vi.fn();
    const source = createWorkspaceServerClientSource({
      idleTtlMs: 0,
      retrySchedule: retrySchedules.sequence([5, 5, 5, 5, 50]),
      openTransport: async (nextTarget) => {
        openCount += 1;
        if (nextTarget.kind !== 'local-socket') throw new Error('Expected local target');
        return await openLocalWorkspaceServerTransport(nextTarget);
      },
    });
    source.onTerminalError(onTerminalError);
    const lease = source.acquire(target);

    try {
      const connection = await lease.ready();
      await server.dispose();
      const replacement = connection.ready();
      await waitFor(() => openCount >= 5);
      server = await serveSocket(
        createTestWorkspaceWireController({}, { daemonId: 'delayed-two' }),
        { socketPath: target.socketPath }
      );

      await expect(replacement).resolves.toMatchObject({ server: { daemonId: 'delayed-two' } });
      expect(onTerminalError).not.toHaveBeenCalled();
      expect(source.peek(target)).toBe(connection);
    } finally {
      await lease.release();
      await source.dispose();
      await server.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps retrying beyond the SSH manager backoff window before becoming terminal', () => {
    const delays = Array.from({ length: 9 }, (_, index) =>
      workspaceServerReconnectSchedule.delayFor(index)
    );
    const total = delays.reduce<number>((sum, delay) => sum + (delay ?? 0), 0);

    expect(total).toBeGreaterThanOrEqual(90_000);
    expect(workspaceServerReconnectSchedule.delayFor(9)).toBeUndefined();
  });
});

function localTarget(socketPath: string): LocalWorkspaceServerTarget {
  return { kind: 'local-socket', socketPath };
}
