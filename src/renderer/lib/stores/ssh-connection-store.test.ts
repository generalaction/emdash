import { describe, expect, it, vi } from 'vitest';
import type { SshConnectionEvent } from '@shared/events/sshEvents';
import { SshConnectionStore } from './ssh-connection-store';

let sshEventHandler: ((event: SshConnectionEvent) => void) | null = null;

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn((_channel, handler: (event: SshConnectionEvent) => void) => {
      sshEventHandler = handler;
      return () => {};
    }),
  },
  rpc: {
    ssh: {
      connect: vi.fn(async () => {}),
      deleteConnection: vi.fn(async () => {}),
      getConnections: vi.fn(async () => []),
      getConnectionState: vi.fn(async () => ({})),
      renameConnection: vi.fn(async () => {}),
      saveConnection: vi.fn(async (config) => ({ ...config, id: 'ssh-1' })),
      testConnection: vi.fn(async () => ({ success: true })),
    },
  },
}));

const { rpc } = await import('@renderer/lib/ipc');

describe('SshConnectionStore', () => {
  it('notifies when an SSH connection becomes ready', () => {
    const onConnectionReady = vi.fn();
    const store = new SshConnectionStore({ onConnectionReady });
    store.start();

    sshEventHandler?.({ type: 'connected', connectionId: 'ssh-1' });
    sshEventHandler?.({ type: 'reconnected', connectionId: 'ssh-1' });
    sshEventHandler?.({ type: 'disconnected', connectionId: 'ssh-1' });

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
});
