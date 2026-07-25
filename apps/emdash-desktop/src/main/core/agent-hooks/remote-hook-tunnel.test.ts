import { EventEmitter } from 'node:events';
import net from 'node:net';
import type { Client, ClientChannel } from 'ssh2';
import { afterEach, describe, expect, it } from 'vitest';
import { RemoteHookTunnelManager, type HookTunnelProxy } from './remote-hook-tunnel';

const BOUND_REMOTE_PORT = 45123;

class FakeClient extends EventEmitter {
  forwardInCalls: Array<{ remoteAddr: string; remotePort: number }> = [];

  constructor(private readonly bind: { error?: Error; port?: number } = {}) {
    super();
  }

  forwardIn(
    remoteAddr: string,
    remotePort: number,
    callback: (error: Error | undefined, port: number) => void
  ): this {
    this.forwardInCalls.push({ remoteAddr, remotePort });
    callback(this.bind.error, this.bind.port ?? BOUND_REMOTE_PORT);
    return this;
  }

  emitTcpConnection(destPort: number, accept: () => ClientChannel): void {
    this.emit(
      'tcp connection',
      { srcIP: '127.0.0.1', srcPort: 1234, destIP: '127.0.0.1', destPort },
      accept,
      () => {}
    );
  }
}

function makeProxy(client: FakeClient, connectionId = 'conn-1'): HookTunnelProxy {
  return {
    connectionId,
    get isConnected() {
      return true;
    },
    get client() {
      return client as unknown as Client;
    },
  };
}

function listen(server: net.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address !== null ? address.port : 0);
    });
  });
}

const servers: net.Server[] = [];
const sockets: net.Socket[] = [];

function track<T extends net.Server | net.Socket>(value: T): T {
  if (value instanceof net.Server) servers.push(value);
  else sockets.push(value);
  return value;
}

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const server of servers.splice(0)) server.close();
});

describe('RemoteHookTunnelManager', () => {
  it('binds a remote loopback port and pipes accepted channels to the hook server', async () => {
    const requests: string[] = [];
    const hookServer = track(
      net.createServer((socket) => {
        socket.on('data', (chunk: Buffer) => {
          requests.push(chunk.toString('utf8'));
          socket.write('hook-ok');
        });
      })
    );
    const hookPort = await listen(hookServer);

    // Stands in for the ssh2 channel: the socket the manager pipes is the one
    // accepted here, the socket dialing in is the one the remote agent holds.
    const channelServer = track(net.createServer());
    const channelPort = await listen(channelServer);
    const accepted = new Promise<net.Socket>((resolve) => {
      channelServer.once('connection', (socket) => resolve(track(socket)));
    });
    const agentSocket = track(net.connect(channelPort, '127.0.0.1'));
    const channel = await accepted;

    const client = new FakeClient();
    const manager = new RemoteHookTunnelManager();
    const remotePort = await manager.ensure(makeProxy(client), hookPort);

    expect(remotePort).toBe(BOUND_REMOTE_PORT);
    expect(client.forwardInCalls).toEqual([{ remoteAddr: '127.0.0.1', remotePort: 0 }]);

    const response = new Promise<string>((resolve) => {
      agentSocket.once('data', (chunk: Buffer) => resolve(chunk.toString('utf8')));
    });
    client.emitTcpConnection(BOUND_REMOTE_PORT, () => channel as unknown as ClientChannel);
    agentSocket.write('POST /hook');

    expect(await response).toBe('hook-ok');
    expect(requests).toEqual(['POST /hook']);
  });

  it('ignores forwarded connections that target another bound port', async () => {
    const client = new FakeClient();
    const manager = new RemoteHookTunnelManager();
    await manager.ensure(makeProxy(client), 4000);

    let accepted = false;
    client.emitTcpConnection(BOUND_REMOTE_PORT + 1, () => {
      accepted = true;
      return new EventEmitter() as unknown as ClientChannel;
    });

    expect(accepted).toBe(false);
  });

  it('reuses one tunnel per connection', async () => {
    const client = new FakeClient();
    const manager = new RemoteHookTunnelManager();
    const proxy = makeProxy(client);

    const [first, second] = await Promise.all([
      manager.ensure(proxy, 4000),
      manager.ensure(proxy, 4000),
    ]);

    expect(first).toBe(BOUND_REMOTE_PORT);
    expect(second).toBe(BOUND_REMOTE_PORT);
    expect(client.forwardInCalls).toHaveLength(1);
  });

  it('rebinds after a reconnect replaces the ssh client', async () => {
    const manager = new RemoteHookTunnelManager();
    const first = new FakeClient();
    await manager.ensure(makeProxy(first), 4000);

    const second = new FakeClient({ port: BOUND_REMOTE_PORT + 7 });
    const rebound = await manager.ensure(makeProxy(second), 4000);

    expect(rebound).toBe(BOUND_REMOTE_PORT + 7);
    expect(second.forwardInCalls).toHaveLength(1);
  });

  it('returns null when the remote refuses port forwarding', async () => {
    const client = new FakeClient({ error: new Error('administratively prohibited') });
    const manager = new RemoteHookTunnelManager();

    expect(await manager.ensure(makeProxy(client), 4000)).toBeNull();
  });

  it('returns null when the hook server is not listening', async () => {
    const client = new FakeClient();
    const manager = new RemoteHookTunnelManager();

    expect(await manager.ensure(makeProxy(client), 0)).toBeNull();
    expect(client.forwardInCalls).toHaveLength(0);
  });
});
