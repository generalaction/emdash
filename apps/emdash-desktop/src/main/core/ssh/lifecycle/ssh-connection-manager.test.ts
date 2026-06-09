import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { Client } from 'ssh2';
import { describe, expect, it, vi } from 'vitest';
import type { SshConnectionRow } from '@main/db/schema';

describe('SshConnectionManager', () => {
  it('cleans up a proxied transport when disconnecting during handshake', async () => {
    process.env.EMDASH_DB_FILE = join(
      await mkdtemp(join(tmpdir(), 'emdash-ssh-manager-')),
      'test.db'
    );
    const { SshConnectionManager } = await import('./ssh-connection-manager');
    const manager = new SshConnectionManager();
    const sockets: Socket[] = [];
    const server: Server = createServer((socket) => {
      sockets.push(socket);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
    let cleanupCount = 0;

    const connectPromise = manager.connectFromConfig(
      'pending',
      {
        host: '127.0.0.1',
        port: address.port,
        username: 'alice',
      },
      () => {
        cleanupCount += 1;
      }
    );
    connectPromise.catch(() => {});
    await new Promise((resolve) => setImmediate(resolve));

    expect(manager.getConnectionState('pending')).toBe('connecting');
    await manager.disconnect('pending');
    for (const socket of sockets) socket.destroy();
    server.close();

    expect(cleanupCount).toBe(1);
    expect(manager.getConnectionState('pending')).toBe('disconnected');
    await expect(connectPromise).rejects.toThrow();
  });

  it('coalesces concurrent persisted connects before resolving proxy transports', async () => {
    const { SshConnectionManager } = await import('./ssh-connection-manager');
    const resolverCalls: string[] = [];
    const cleanupCalls: string[] = [];
    let releaseResolver!: () => void;
    const resolverGate = new Promise<void>((resolve) => {
      releaseResolver = resolve;
    });
    const row: SshConnectionRow = {
      id: 'ssh-1',
      name: 'Stored',
      host: 'stored.example.com',
      port: 22,
      username: 'alice',
      authType: 'agent',
      privateKeyPath: null,
      useAgent: 1,
      metadata: null,
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z',
    };

    const manager = new SshConnectionManager({
      loadConnectionRow: async () => row,
      resolveConnectConfig: async (resolvedRow) => {
        resolverCalls.push(resolvedRow.id);
        await resolverGate;
        return {
          config: { sock: new PassThrough(), username: 'alice' },
          cleanup: () => cleanupCalls.push(resolvedRow.id),
          debugLogs: [],
        };
      },
    });

    const firstConnect = manager.connect('ssh-1');
    const secondConnect = manager.connect('ssh-1');
    await new Promise((resolve) => setImmediate(resolve));

    expect(resolverCalls).toEqual(['ssh-1']);

    releaseResolver();
    await manager.disconnect('ssh-1');

    await expect(firstConnect).rejects.toThrow();
    await expect(secondConnect).rejects.toThrow();
    expect(cleanupCalls).toEqual(['ssh-1']);
  });

  it('does not allow a stale resolving connect to create a client after disconnect and reconnect', async () => {
    const { SshConnectionManager } = await import('./ssh-connection-manager');
    const cleanupCalls: string[] = [];
    const createClientCalls: string[] = [];
    let releaseFirstResolver!: () => void;
    let releaseSecondResolver!: () => void;
    const firstResolverGate = new Promise<void>((resolve) => {
      releaseFirstResolver = resolve;
    });
    const secondResolverGate = new Promise<void>((resolve) => {
      releaseSecondResolver = resolve;
    });
    const row: SshConnectionRow = {
      id: 'ssh-1',
      name: 'Stored',
      host: 'stored.example.com',
      port: 22,
      username: 'alice',
      authType: 'agent',
      privateKeyPath: null,
      useAgent: 1,
      metadata: null,
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z',
    };
    let resolverCall = 0;

    const manager = new SshConnectionManager({
      loadConnectionRow: async () => row,
      resolveConnectConfig: async () => {
        resolverCall += 1;
        const call = resolverCall;
        await (call === 1 ? firstResolverGate : secondResolverGate);
        return {
          config: { sock: new PassThrough(), username: `alice-${call}` },
          cleanup: () => cleanupCalls.push(`cleanup-${call}`),
          debugLogs: [],
        };
      },
      createClient: () => {
        createClientCalls.push('client');
        return new (class extends PassThrough {
          connect() {}
        })() as unknown as Client;
      },
    });

    const firstConnect = manager.connect('ssh-1');
    firstConnect.catch(() => {});
    await new Promise((resolve) => setImmediate(resolve));
    await manager.disconnect('ssh-1');

    const secondConnect = manager.connect('ssh-1');
    secondConnect.catch(() => {});

    releaseFirstResolver();
    await expect(firstConnect).rejects.toThrow('was disconnected before connecting');
    expect(createClientCalls).toEqual([]);
    expect(cleanupCalls).toEqual(['cleanup-1']);

    releaseSecondResolver();
    await new Promise((resolve) => setImmediate(resolve));
    expect(createClientCalls).toEqual(['client']);
    await manager.disconnect('ssh-1');
  });

  it('cleans up transport state when client.connect throws synchronously', async () => {
    const { SshConnectionManager } = await import('./ssh-connection-manager');
    const cleanupCalls: string[] = [];
    const manager = new SshConnectionManager({
      createClient: () =>
        new (class extends PassThrough {
          connect() {
            throw new Error('sync connect failure');
          }
        })() as unknown as Client,
    });

    await expect(
      manager.connectFromConfig(
        'sync-failure',
        { sock: new PassThrough(), username: 'alice' },
        () => cleanupCalls.push('cleanup')
      )
    ).rejects.toThrow('sync connect failure');

    expect(cleanupCalls).toEqual(['cleanup']);
    expect(manager.getConnectionState('sync-failure')).toBe('disconnected');
  });

  it('destroys a client when graceful disconnect times out', async () => {
    vi.useFakeTimers();
    try {
      const { SshConnectionManager } = await import('./ssh-connection-manager');
      class StuckCloseClient extends PassThrough {
        destroyCalls = 0;
        connect() {
          queueMicrotask(() => this.emit('ready'));
        }
        end() {
          return this;
        }
        destroy(error?: Error) {
          this.destroyCalls += 1;
          return super.destroy(error);
        }
      }
      const client = new StuckCloseClient();
      const manager = new SshConnectionManager({
        createClient: () => client as unknown as Client,
      });

      const proxy = await manager.connectFromConfig('stuck-close', {
        sock: new PassThrough(),
        username: 'alice',
      });
      expect(proxy.isConnected).toBe(true);

      const disconnectPromise = manager.disconnect('stuck-close');
      await vi.advanceTimersByTimeAsync(5_000);
      await disconnectPromise;

      expect(client.destroyCalls).toBe(1);
      expect(manager.getConnectionState('stuck-close')).toBe('disconnected');
    } finally {
      vi.useRealTimers();
    }
  });

  it('destroys a pending client when disconnect times out before ready', async () => {
    vi.useFakeTimers();
    try {
      const { SshConnectionManager } = await import('./ssh-connection-manager');
      class StuckHandshakeClient extends PassThrough {
        destroyCalls = 0;
        connect() {}
        end() {
          return this;
        }
        destroy(error?: Error) {
          this.destroyCalls += 1;
          this.emit('close');
          return super.destroy(error);
        }
      }
      const client = new StuckHandshakeClient();
      const cleanupCalls: string[] = [];
      const manager = new SshConnectionManager({
        createClient: () => client as unknown as Client,
      });

      const connectPromise = manager.connectFromConfig(
        'pending-timeout',
        {
          sock: new PassThrough(),
          username: 'alice',
        },
        () => cleanupCalls.push('cleanup')
      );
      connectPromise.catch(() => {});
      await vi.advanceTimersByTimeAsync(0);

      const disconnectPromise = manager.disconnect('pending-timeout');
      await vi.advanceTimersByTimeAsync(5_000);
      await disconnectPromise;

      expect(client.destroyCalls).toBe(1);
      expect(cleanupCalls).toEqual(['cleanup']);
      expect(manager.getConnectionState('pending-timeout')).toBe('disconnected');
      await expect(connectPromise).rejects.toThrow('SSH connection closed before ready');
    } finally {
      vi.useRealTimers();
    }
  });

  it('disconnectAll cancels pending persisted connects before they create clients', async () => {
    const { SshConnectionManager } = await import('./ssh-connection-manager');
    const cleanupCalls: string[] = [];
    const createClientCalls: string[] = [];
    let releaseResolver!: () => void;
    const resolverGate = new Promise<void>((resolve) => {
      releaseResolver = resolve;
    });
    const row: SshConnectionRow = {
      id: 'ssh-1',
      name: 'Stored',
      host: 'stored.example.com',
      port: 22,
      username: 'alice',
      authType: 'agent',
      privateKeyPath: null,
      useAgent: 1,
      metadata: null,
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z',
    };
    const manager = new SshConnectionManager({
      loadConnectionRow: async () => row,
      resolveConnectConfig: async () => {
        await resolverGate;
        return {
          config: { sock: new PassThrough(), username: 'alice' },
          cleanup: () => cleanupCalls.push('cleanup'),
          debugLogs: [],
        };
      },
      createClient: () => {
        createClientCalls.push('client');
        return new PassThrough() as unknown as Client;
      },
    });

    const connectPromise = manager.connect('ssh-1');
    connectPromise.catch(() => {});
    await new Promise((resolve) => setImmediate(resolve));

    expect(manager.getAllConnectionStates()).toEqual({ 'ssh-1': 'connecting' });
    await manager.disconnectAll();
    releaseResolver();

    await expect(connectPromise).rejects.toThrow('was disconnected before connecting');
    expect(cleanupCalls).toEqual(['cleanup']);
    expect(createClientCalls).toEqual([]);
  });

  it('invalidates a ready proxy when the client emits an error before close', async () => {
    const { SshConnectionManager } = await import('./ssh-connection-manager');
    class FakeReadyClient extends PassThrough {
      connect() {
        queueMicrotask(() => this.emit('ready'));
      }
      end() {
        this.emit('close');
        return this;
      }
    }
    const client = new FakeReadyClient();
    const manager = new SshConnectionManager({
      createClient: () => client as unknown as Client,
    });

    const proxy = await manager.connectFromConfig('ready-error', {
      sock: new PassThrough(),
      username: 'alice',
    });
    expect(proxy.isConnected).toBe(true);

    client.emit('error', new Error('transport failed'));

    expect(proxy.isConnected).toBe(false);
    expect(manager.getConnectionState('ready-error')).toBe('disconnected');
  });

  it('schedules reconnect when a ready persisted client emits error before close', async () => {
    vi.useFakeTimers();
    try {
      const { SshConnectionManager } = await import('./ssh-connection-manager');
      class FakeReadyClient extends PassThrough {
        connect() {
          queueMicrotask(() => this.emit('ready'));
        }
        end() {
          this.emit('close');
          return this;
        }
      }
      const client = new FakeReadyClient();
      const events: string[] = [];
      const row: SshConnectionRow = {
        id: 'ssh-1',
        name: 'Stored',
        host: 'stored.example.com',
        port: 22,
        username: 'alice',
        authType: 'agent',
        privateKeyPath: null,
        useAgent: 1,
        metadata: null,
        createdAt: '2026-05-20T00:00:00.000Z',
        updatedAt: '2026-05-20T00:00:00.000Z',
      };
      const clients: FakeReadyClient[] = [];
      const manager = new SshConnectionManager({
        loadConnectionRow: async () => row,
        resolveConnectConfig: async () => ({
          config: { sock: new PassThrough(), username: 'alice' },
          cleanup: () => {},
          debugLogs: [],
        }),
        createClient: () => {
          const nextClient = clients.length === 0 ? client : new FakeReadyClient();
          clients.push(nextClient);
          return nextClient as unknown as Client;
        },
      });
      manager.on('connection-event', (event) => events.push(event.type));

      const proxy = await manager.connect('ssh-1');
      expect(proxy.isConnected).toBe(true);

      client.emit('error', new Error('transport failed'));
      client.emit('close');

      expect(events.filter((event) => event === 'disconnected')).toHaveLength(1);
      expect(events).toContain('reconnecting');
      expect(manager.getConnectionState('ssh-1')).toBe('reconnecting');

      await vi.advanceTimersByTimeAsync(1_000);
      expect(manager.getProxy('ssh-1')).toBe(proxy);
      expect(proxy.isConnected).toBe(true);
      expect(proxy.client).toBe(clients[1]);
      await manager.disconnect('ssh-1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not re-enter reconnecting after disconnecting an in-flight reconnect', async () => {
    vi.useFakeTimers();
    try {
      const { SshConnectionManager } = await import('./ssh-connection-manager');
      class FakeReadyClient extends PassThrough {
        connect() {
          queueMicrotask(() => this.emit('ready'));
        }
        end() {
          this.emit('close');
          return this;
        }
      }
      const client = new FakeReadyClient();
      const events: string[] = [];
      const row: SshConnectionRow = {
        id: 'ssh-1',
        name: 'Stored',
        host: 'stored.example.com',
        port: 22,
        username: 'alice',
        authType: 'agent',
        privateKeyPath: null,
        useAgent: 1,
        metadata: null,
        createdAt: '2026-05-20T00:00:00.000Z',
        updatedAt: '2026-05-20T00:00:00.000Z',
      };
      let resolveCalls = 0;
      let releaseReconnect!: () => void;
      const reconnectGate = new Promise<void>((resolve) => {
        releaseReconnect = resolve;
      });
      const manager = new SshConnectionManager({
        loadConnectionRow: async () => row,
        resolveConnectConfig: async () => {
          resolveCalls += 1;
          if (resolveCalls > 1) {
            await reconnectGate;
            throw new Error('reconnect failed after disconnect');
          }
          return {
            config: { sock: new PassThrough(), username: 'alice' },
            cleanup: () => {},
            debugLogs: [],
          };
        },
        createClient: () => client as unknown as Client,
      });
      manager.on('connection-event', (event) => events.push(event.type));

      await manager.connect('ssh-1');
      client.emit('error', new Error('transport failed'));
      client.emit('close');
      await vi.advanceTimersByTimeAsync(1_000);

      await manager.disconnect('ssh-1');
      const reconnectingBeforeRelease = events.filter((event) => event === 'reconnecting').length;
      releaseReconnect();
      await vi.advanceTimersByTimeAsync(0);

      expect(events.filter((event) => event === 'reconnecting')).toHaveLength(
        reconnectingBeforeRelease
      );
      expect(manager.getConnectionState('ssh-1')).toBe('disconnected');
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a stale in-flight handshake that becomes ready after disconnect and reconnect', async () => {
    const { SshConnectionManager } = await import('./ssh-connection-manager');
    class ManualReadyClient extends PassThrough {
      connect() {}
    }
    const clients: ManualReadyClient[] = [];
    const row: SshConnectionRow = {
      id: 'ssh-1',
      name: 'Stored',
      host: 'stored.example.com',
      port: 22,
      username: 'alice',
      authType: 'agent',
      privateKeyPath: null,
      useAgent: 1,
      metadata: null,
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z',
    };
    const manager = new SshConnectionManager({
      loadConnectionRow: async () => row,
      resolveConnectConfig: async () => ({
        config: { sock: new PassThrough(), username: 'alice' },
        cleanup: () => {},
        debugLogs: [],
      }),
      createClient: () => {
        const client = new ManualReadyClient();
        clients.push(client);
        return client as unknown as Client;
      },
    });

    const firstConnect = manager.connect('ssh-1');
    firstConnect.catch(() => {});
    await new Promise((resolve) => setImmediate(resolve));
    await manager.disconnect('ssh-1');

    const secondConnect = manager.connect('ssh-1');
    secondConnect.catch(() => {});
    await new Promise((resolve) => setImmediate(resolve));

    clients[0]!.emit('ready');
    await expect(firstConnect).rejects.toThrow('SSH connection closed before ready');

    clients[1]!.emit('ready');
    const secondProxy = await secondConnect;
    expect(secondProxy.isConnected).toBe(true);
    expect(secondProxy.client).toBe(clients[1]);
  });

  it('reports and clears degraded health for channel open failures', async () => {
    const { SshConnectionManager } = await import('./ssh-connection-manager');
    const published: unknown[] = [];
    const manager = new SshConnectionManager({
      publishEvent: (event) => published.push(event),
    });

    manager.reportChannelError('ssh-1', new Error('ordinary failure'));
    expect(manager.getAllHealthStates()).toEqual({});

    manager.reportChannelError('ssh-1', { reason: 2, message: 'channel open failure' });
    expect(manager.getAllHealthStates()).toEqual({ 'ssh-1': { status: 'degraded' } });

    manager.reportChannelRecovered('ssh-1');
    expect(manager.getAllHealthStates()).toEqual({});
    expect(published).toEqual([
      { type: 'health-changed', connectionId: 'ssh-1', health: { status: 'degraded' } },
      { type: 'health-changed', connectionId: 'ssh-1', health: { status: 'ok' } },
    ]);
  });

  it('rejects persisted connects when production dependencies or rows are missing', async () => {
    const { SshConnectionManager } = await import('./ssh-connection-manager');

    await expect(new SshConnectionManager().connect('missing-deps')).rejects.toThrow(
      'missing production dependencies'
    );

    const manager = new SshConnectionManager({
      loadConnectionRow: async () => undefined,
      resolveConnectConfig: async () => {
        throw new Error('should not resolve');
      },
    });

    await expect(manager.connect('missing-row')).rejects.toThrow('not found');
  });

  it('classifies handshake authentication and timeout errors', async () => {
    const { SshAuthError, SshConnectionManager, SshTimeoutError } =
      await import('./ssh-connection-manager');
    class ErrorClient extends PassThrough {
      constructor(private readonly error: Error) {
        super();
      }
      connect() {
        queueMicrotask(() => this.emit('error', this.error));
      }
    }

    await expect(
      new SshConnectionManager({
        createClient: () => new ErrorClient(new Error('permission denied')) as unknown as Client,
      }).connectFromConfig('auth-failure', { sock: new PassThrough(), username: 'alice' })
    ).rejects.toBeInstanceOf(SshAuthError);

    await expect(
      new SshConnectionManager({
        createClient: () => new ErrorClient(new Error('ready timeout')) as unknown as Client,
      }).connectFromConfig('timeout-failure', { sock: new PassThrough(), username: 'alice' })
    ).rejects.toBeInstanceOf(SshTimeoutError);
  });

  it('stops reconnecting immediately after an auth failure during reconnect', async () => {
    vi.useFakeTimers();
    try {
      const { SshAuthError, SshConnectionManager } = await import('./ssh-connection-manager');
      class FakeReadyClient extends PassThrough {
        connect() {
          queueMicrotask(() => this.emit('ready'));
        }
        end() {
          this.emit('close');
          return this;
        }
      }
      const client = new FakeReadyClient();
      const events: string[] = [];
      const row: SshConnectionRow = {
        id: 'ssh-1',
        name: 'Stored',
        host: 'stored.example.com',
        port: 22,
        username: 'alice',
        authType: 'agent',
        privateKeyPath: null,
        useAgent: 1,
        metadata: null,
        createdAt: '2026-05-20T00:00:00.000Z',
        updatedAt: '2026-05-20T00:00:00.000Z',
      };
      let resolveCalls = 0;
      const manager = new SshConnectionManager({
        loadConnectionRow: async () => row,
        resolveConnectConfig: async () => {
          resolveCalls += 1;
          if (resolveCalls > 1) throw new SshAuthError('auth failed');
          return {
            config: { sock: new PassThrough(), username: 'alice' },
            cleanup: () => {},
            debugLogs: [],
          };
        },
        createClient: () => client as unknown as Client,
      });
      manager.on('connection-event', (event) => events.push(event.type));

      await manager.connect('ssh-1');
      client.emit('error', new Error('transport failed'));
      client.emit('close');
      await vi.advanceTimersByTimeAsync(1_000);

      expect(events).toContain('reconnect-failed');
      expect(manager.getConnectionState('ssh-1')).toBe('disconnected');
    } finally {
      vi.useRealTimers();
    }
  });
});
