import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SshConnectionEvent } from '@core/primitives/ssh/api';
import { SshConnectionStore } from './ssh-connection-store';

const sshEventHandlers: Array<(event: SshConnectionEvent) => void> = [];

function emitSshEvent(event: SshConnectionEvent): void {
  for (const handler of sshEventHandlers) handler(event);
}

const ssh = vi.hoisted(() => ({
  connect: vi.fn(async () => {}),
  deleteConnection: vi.fn(async () => {}),
  getConnections: vi.fn(async () => []),
  getConnectionState: vi.fn(async () => ({})),
  getHealthStates: vi.fn(async () => ({})),
  getSshConfigHost: vi.fn(async ({ alias }: { alias: string }) => ({ host: alias })),
  getSshConfigHosts: vi.fn(async () => []),
  renameConnection: vi.fn(async () => {}),
  saveConnection: vi.fn(async (config) => ({ ...config, id: 'ssh-1' })),
  testConnection: vi.fn(async () => ({ success: true })),
  subscribe: vi.fn(async (_key, observer: { onEvent: (event: SshConnectionEvent) => void }) => {
    sshEventHandlers.push(observer.onEvent);
    return () => {};
  }),
}));

vi.mock('@renderer/lib/runtime/desktop-wire-client', () => ({
  getDesktopWireClient: async () => ({
    ssh: { ...ssh, events: { subscribe: ssh.subscribe } },
  }),
}));

describe('SshConnectionStore', () => {
  beforeEach(() => {
    sshEventHandlers.length = 0;
    vi.clearAllMocks();
  });

  it('notifies when an SSH connection becomes ready', async () => {
    const onConnectionReady = vi.fn();
    const store = new SshConnectionStore({ onConnectionReady });
    store.start();
    await vi.waitFor(() => expect(sshEventHandlers).toHaveLength(1));

    emitSshEvent({ type: 'connected', connectionId: 'ssh-1' });
    emitSshEvent({ type: 'reconnected', connectionId: 'ssh-1' });
    emitSshEvent({ type: 'disconnected', connectionId: 'ssh-1' });

    expect(onConnectionReady).toHaveBeenCalledTimes(2);
    expect(onConnectionReady).toHaveBeenNthCalledWith(1, 'ssh-1');
    expect(onConnectionReady).toHaveBeenNthCalledWith(2, 'ssh-1');
  });

  it('notifies for initially connected SSH connections', async () => {
    ssh.getConnectionState.mockResolvedValueOnce({
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

  it('tracks SSH health changes separately from connection state', async () => {
    const store = new SshConnectionStore();
    store.start();
    await vi.waitFor(() => expect(sshEventHandlers).toHaveLength(1));

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

  it('allows forced connect while reconnecting', async () => {
    const store = new SshConnectionStore();
    store.start();
    await vi.waitFor(() => expect(sshEventHandlers).toHaveLength(1));

    emitSshEvent({
      type: 'reconnecting',
      connectionId: 'ssh-1',
      attempt: 1,
      delayMs: 20_000,
    });

    await store.connect('ssh-1');
    expect(ssh.connect).not.toHaveBeenCalled();

    await store.connect('ssh-1', { force: true });
    expect(ssh.connect).toHaveBeenCalledWith({ connectionId: 'ssh-1' });
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

    expect(ssh.saveConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        sshConfigAlias: 'corp-dev',
        forwardAgent: true,
        proxyJump: 'bastion',
      })
    );
  });
});
