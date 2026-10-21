import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { Client, ClientChannel } from 'ssh2';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SshClientProxy } from './lifecycle/ssh-client-proxy';
import { SshConnectionManager } from './lifecycle/ssh-connection-manager';

// Faults enter at the ssh2 boundary. The actual manager, stable proxy, and
// stream-local operation run unchanged; no sockets or credentials are used.
class FaultSshClient extends EventEmitter {
  handshakeError: Error | undefined;
  openReply: Parameters<Client['openssh_forwardOutStreamLocal']>[1] | undefined;

  connect() {
    queueMicrotask(() => {
      if (this.handshakeError) {
        this.emit('error', this.handshakeError);
        this.emit('close');
      } else {
        this.emit('ready');
      }
    });
    return this;
  }

  openssh_forwardOutStreamLocal(
    _path: string,
    callback: Parameters<Client['openssh_forwardOutStreamLocal']>[1]
  ) {
    this.openReply = callback;
  }

  end() {
    this.emit('close');
  }
  destroy() {
    this.emit('close');
  }

  asClient(): Client {
    // Only the ssh2 operations used by these production paths are simulated.
    return this as unknown as Client;
  }
}

describe('Host supervisor SSH adapter acceptance (ADR 0008)', () => {
  let clients: FaultSshClient[];
  let manager: SshConnectionManager;
  let nextHandshakeError: Error | undefined;
  const resolve = async () => ({
    config: { host: 'fault.invalid', username: 'acceptance' },
    cleanup() {},
    debugLogs: [],
  });

  beforeEach(() => {
    vi.useFakeTimers();
    clients = [];
    nextHandshakeError = undefined;
    manager = new SshConnectionManager({
      createClient: () => {
        const client = new FaultSshClient();
        client.handshakeError = nextHandshakeError;
        clients.push(client);
        return client.asClient();
      },
    });
  });

  afterEach(async () => {
    try {
      await manager.disconnectAll();
      await vi.advanceTimersByTimeAsync(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds an SSH stream-local open that never receives a reply or close', async () => {
    const client = new FaultSshClient();
    const proxy = new SshClientProxy('test');
    proxy.update(client.asClient());
    const opening = proxy.forwardOutStreamLocal('/workspace.sock');
    let rejected = false;
    void opening.catch(() => {
      rejected = true;
    });
    try {
      await vi.advanceTimersByTimeAsync(10_001);
      expect(rejected).toBe(true);
    } finally {
      client.emit('close');
      await opening.catch(() => {});
    }
  });

  it('destroys a channel delivered after its SSH connection closed', async () => {
    const client = new FaultSshClient();
    const proxy = new SshClientProxy('test');
    proxy.update(client.asClient());
    const opening = proxy.forwardOutStreamLocal('/workspace.sock');
    const rejected = expect(opening).rejects.toThrow('SSH connection closed');
    client.emit('close');
    await rejected;

    const channel = new PassThrough();
    // ssh2's channel adds terminal methods irrelevant to channel disposal here.
    client.openReply?.(undefined, channel as unknown as ClientChannel);

    expect(channel.destroyed).toBe(true);
    expect(client.listenerCount('close')).toBe(0);
    expect(client.listenerCount('error')).toBe(0);
  });

  it('an old SSH close cannot invalidate a successfully established replacement', async () => {
    const proxy = await manager.createConnection('host', resolve);
    const oldClient = clients[0]!;
    oldClient.emit('error', new Error('Old network path failed'));
    await expect(manager.createConnection('host', resolve)).resolves.toBe(proxy);
    const replacement = proxy.client;

    oldClient.emit('close');

    expect(proxy.isConnected).toBe(true);
    expect(proxy.client).toBe(replacement);
    expect(manager.getConnectionState('host')).toBe('connected');
  });

  it('preserves the SSH proxy when an ordinary disconnect successfully reconnects', async () => {
    const proxy = await manager.createConnection('host', resolve);
    const previous = proxy.client;
    clients[0]!.emit('close');
    await vi.advanceTimersByTimeAsync(1_000);
    await manager.createConnection('host', resolve);

    expect(manager.getProxy('host')).toBe(proxy);
    expect(proxy.isConnected).toBe(true);
    expect(proxy.client).not.toBe(previous);
  });

  it('stops physical SSH retries when authentication fails during recovery', async () => {
    await manager.createConnection('host', resolve);
    nextHandshakeError = new Error('All configured authentication methods failed');
    clients[0]!.emit('close');
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(manager.createConnection('host', resolve)).rejects.toThrow('authentication');

    expect(manager.getConnectionState('host')).toBe('disconnected');
    expect(clients).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(clients).toHaveLength(2);
  });
});
