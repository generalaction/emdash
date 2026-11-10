import { Socket } from 'node:net';
import { Duplex } from 'node:stream';
import ssh2, { type Client } from 'ssh2';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SshConnectionManager } from './ssh-connection-manager';

describe('SshConnectionManager transport configuration', () => {
  let manager: SshConnectionManager;
  let clients: Client[];

  beforeEach(() => {
    clients = [];
    manager = new SshConnectionManager({
      createClient: () => {
        const client = new ssh2.Client();
        clients.push(client);
        return client;
      },
    });
  });

  afterEach(async () => {
    await manager.disconnectAll();
    vi.restoreAllMocks();
  });

  it.each([false, true])(
    'disables Nagle before ready on every physical connection (ephemeral: %s)',
    async (ephemeral) => {
      // Keep real ssh2 socket creation and option delegation, but prevent network I/O.
      // Readiness is driven below so this also rejects moving the option to `ready`.
      const connect = vi.spyOn(Socket.prototype, 'connect').mockReturnThis();
      const setNoDelay = vi.spyOn(Socket.prototype, 'setNoDelay');
      const resolve = async () => ({
        config: { host: 'transport.invalid', username: 'alice' },
        cleanup() {},
        debugLogs: [],
      });

      const first = manager.createConnection('host', resolve, { ephemeral });
      void first.catch(() => {});
      await new Promise<void>((done) => setImmediate(done));

      expect(manager.isConnected('host')).toBe(false);
      expect(connect).toHaveBeenCalledTimes(1);
      expect(setNoDelay).toHaveBeenCalledExactlyOnceWith(true);
      expect(setNoDelay.mock.contexts[0]).toBe(connect.mock.contexts[0]);
      expect(setNoDelay.mock.invocationCallOrder[0]).toBeGreaterThan(
        connect.mock.invocationCallOrder[0]!
      );

      clients[0]!.emit('ready');
      const proxy = await first;
      await expect(manager.createConnection('host', resolve)).resolves.toBe(proxy);
      expect(setNoDelay).toHaveBeenCalledTimes(1);

      manager.resetConnection('host');
      const replacement = manager.createConnection('host', resolve, { ephemeral });
      void replacement.catch(() => {});
      await new Promise<void>((done) => setImmediate(done));

      expect(manager.isConnected('host')).toBe(false);
      expect(clients).toHaveLength(2);
      expect(connect).toHaveBeenCalledTimes(2);
      expect(setNoDelay).toHaveBeenCalledTimes(2);
      expect(setNoDelay).toHaveBeenNthCalledWith(2, true);
      expect(setNoDelay.mock.contexts[1]).toBe(connect.mock.contexts[1]);
      expect(setNoDelay.mock.contexts[1]).not.toBe(setNoDelay.mock.contexts[0]);
      expect(setNoDelay.mock.invocationCallOrder[1]).toBeGreaterThan(
        connect.mock.invocationCallOrder[1]!
      );

      clients[1]!.emit('ready');
      await expect(replacement).resolves.toBe(proxy);
      expect(proxy.client).toBe(clients[1]);
    }
  );

  it('accepts a proxy-style Duplex without a setNoDelay method', async () => {
    const connect = vi.spyOn(Socket.prototype, 'connect').mockReturnThis();
    const setNoDelay = vi.spyOn(ssh2.Client.prototype, 'setNoDelay');
    const sock = new Duplex({
      read() {},
      write(_chunk, _encoding, done) {
        done();
      },
    });
    const cleanup = vi.fn(() => {
      sock.destroy();
    });
    const connecting = manager.createConnection('proxy', async () => ({
      config: { sock, username: 'alice' },
      cleanup,
      debugLogs: [],
    }));
    void connecting.catch(() => {});
    await new Promise<void>((done) => setImmediate(done));

    expect(sock).not.toHaveProperty('setNoDelay');
    expect(connect).not.toHaveBeenCalled();
    expect(setNoDelay).toHaveBeenCalledExactlyOnceWith(true);
    expect(manager.getConnectionState('proxy')).toBe('connecting');

    clients[0]!.emit('ready');
    const proxy = await connecting;
    expect(proxy.isConnected).toBe(true);
    await manager.dropConnection('proxy');
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(sock.destroyed).toBe(true);
  });

  it('cleans up the physical transport if configuring no-delay throws', async () => {
    const connect = vi.spyOn(Socket.prototype, 'connect').mockReturnThis();
    vi.spyOn(Socket.prototype, 'setNoDelay').mockImplementation(() => {
      throw new Error('socket option failed');
    });
    const cleanup = vi.fn();

    await expect(
      manager.createConnection('failure', async () => ({
        config: { host: 'transport.invalid', username: 'alice' },
        cleanup,
        debugLogs: [],
      }))
    ).rejects.toThrow('socket option failed');

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(connect.mock.contexts[0]).toMatchObject({ destroyed: true });
    expect(manager.getConnectionState('failure')).toBe('disconnected');
  });
});
