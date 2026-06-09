import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SshConnectionEvent } from '@shared/core/ssh/sshEvents';
import { SshConnectionStore } from './ssh-connection-store';

const sshEventHandlers: Array<(event: SshConnectionEvent) => void> = [];

function emitSshEvent(event: SshConnectionEvent): void {
  for (const handler of sshEventHandlers) handler(event);
}

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn((_channel, handler: (event: SshConnectionEvent) => void) => {
      sshEventHandlers.push(handler);
      return () => {};
    }),
  },
  rpc: {
    ssh: {
      connect: vi.fn(async () => {}),
      deleteConnection: vi.fn(async () => {}),
      getConnections: vi.fn(async () => []),
      getConnectionState: vi.fn(async () => ({})),
      getHealthStates: vi.fn(async () => ({})),
      getSshConfigHost: vi.fn(async (alias) => ({ host: alias })),
      getSshConfigHosts: vi.fn(async () => []),
      renameConnection: vi.fn(async () => {}),
      saveConnection: vi.fn(async (config) => ({ ...config, id: 'ssh-1' })),
      testConnection: vi.fn(async () => ({ success: true })),
    },
  },
}));

const { rpc } = await import('@renderer/lib/ipc');

describe('SshConnectionStore', () => {
  beforeEach(() => {
    sshEventHandlers.length = 0;
  });

  it('notifies when an SSH connection becomes ready', () => {
    const onConnectionReady = vi.fn();
    const store = new SshConnectionStore({ onConnectionReady });
    store.start();

    emitSshEvent({ type: 'connected', connectionId: 'ssh-1' });
    emitSshEvent({ type: 'reconnected', connectionId: 'ssh-1' });
    emitSshEvent({ type: 'disconnected', connectionId: 'ssh-1' });

    expect(onConnectionReady).toHaveBeenCalledTimes(2);
    expect(onConnectionReady).toHaveBeenNthCalledWith(1, 'ssh-1');
    expect(onConnectionReady).toHaveBeenNthCalledWith(2, 'ssh-1');
  });

  it('notifies for initially connected SSH connections', async () => {
    vi.mocked(rpc.ssh.getConnectionState).mockResolvedValueOnce({
      'ssh-1': 'connected',
      'ssh-2': 'disconnected',
    });
    const onConnectionReady = vi.fn();
    const store = new SshConnectionStore({ onConnectionReady });

    store.start();
    await store.connectionStatesResource.load();

    expect(onConnectionReady).toHaveBeenCalledWith('ssh-1');
    expect(onConnectionReady).not.toHaveBeenCalledWith('ssh-2');
  });

  it('tracks SSH health changes separately from connection state', () => {
    const store = new SshConnectionStore();
    store.start();

    emitSshEvent({
      type: 'health-changed',
      connectionId: 'ssh-1',
      health: {
        status: 'degraded',
      },
    });

    expect(store.healthFor('ssh-1')).toEqual({
      status: 'degraded',
    });
    expect(store.stateFor('ssh-1')).toBe('disconnected');

    emitSshEvent({
      type: 'health-changed',
      connectionId: 'ssh-1',
      health: { status: 'ok' },
    });

    expect(store.healthFor('ssh-1')).toEqual({ status: 'ok' });
    expect(store.healthStates).toEqual({});
  });

  it('passes SSH config alias and proxy metadata through saveConnection', async () => {
    const store = new SshConnectionStore();

    await store.saveConnection({
      name: 'Corp',
      host: 'corp.example.com',
      port: 22,
      username: 'alice',
      authType: 'agent',
      useAgent: true,
      sshConfigAlias: 'corp-dev',
      forwardAgent: true,
      proxyJump: 'bastion',
    });

    expect(rpc.ssh.saveConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        sshConfigAlias: 'corp-dev',
        forwardAgent: true,
        proxyJump: 'bastion',
      })
    );
  });
});
