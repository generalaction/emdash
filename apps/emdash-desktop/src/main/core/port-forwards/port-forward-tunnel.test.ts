import net from 'node:net';
import { Transform } from 'node:stream';
import type { ClientChannel } from 'ssh2';
import { afterEach, describe, expect, it } from 'vitest';
import type { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import { openPortForwardTunnel } from './port-forward-tunnel';

class EchoChannel extends Transform {
  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    this.push(Buffer.from(`remote:${chunk.toString('utf8')}`));
    callback();
  }
}

function makeProxy() {
  const calls: Array<{
    sourceHost: string;
    sourcePort: number;
    remoteHost: string;
    remotePort: number;
  }> = [];

  return {
    calls,
    proxy: {
      get isConnected() {
        return true;
      },
      get client() {
        return {
          forwardOut(
            sourceHost: string,
            sourcePort: number,
            remoteHost: string,
            remotePort: number,
            callback: (error: Error | undefined, channel: ClientChannel) => void
          ) {
            calls.push({ sourceHost, sourcePort, remoteHost, remotePort });
            callback(undefined, new EchoChannel() as unknown as ClientChannel);
          },
        } as SshClientProxy['client'];
      },
    } satisfies Pick<SshClientProxy, 'client' | 'isConnected'>,
  };
}

function makeRejectingProxy(error: Error) {
  return {
    proxy: {
      get isConnected() {
        return true;
      },
      get client() {
        return {
          forwardOut(
            _sourceHost: string,
            _sourcePort: number,
            _remoteHost: string,
            _remotePort: number,
            callback: (error: Error | undefined, channel: ClientChannel) => void
          ) {
            callback(error, undefined as unknown as ClientChannel);
          },
        } as SshClientProxy['client'];
      },
    } satisfies Pick<SshClientProxy, 'client' | 'isConnected'>,
  };
}

function listen(server: net.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server.address();
      if (typeof address === 'object' && address) {
        resolve(address.port);
        return;
      }
      reject(new Error('server did not bind to a TCP port'));
    });
  });
}

function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function roundTrip(port: number, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let data = '';
    socket.setTimeout(1000);
    socket.on('connect', () => socket.write(payload));
    socket.on('data', (chunk) => {
      data += chunk.toString('utf8');
      socket.end();
    });
    socket.on('end', () => resolve(data));
    socket.on('error', reject);
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('socket timed out'));
    });
  });
}

function connectUntilClosed(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(1000);
    socket.on('connect', () => socket.write('ping'));
    socket.on('close', () => resolve());
    socket.on('error', () => resolve());
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('socket timed out'));
    });
  });
}

describe('openPortForwardTunnel', () => {
  const blockers: net.Server[] = [];

  afterEach(async () => {
    await Promise.all(blockers.splice(0).map(closeServer));
  });

  it('binds a local listener and forwards sockets through ssh2 forwardOut', async () => {
    const { proxy, calls } = makeProxy();

    const tunnel = await openPortForwardTunnel({
      proxy,
      remotePort: 5173,
    });

    try {
      await expect(roundTrip(tunnel.localPort, 'ping')).resolves.toBe('remote:ping');
      expect(calls).toEqual([
        {
          sourceHost: '127.0.0.1',
          sourcePort: 0,
          remoteHost: '127.0.0.1',
          remotePort: 5173,
        },
      ]);
    } finally {
      await tunnel.close();
    }
  });

  it('falls back to an OS-selected local port when the preferred port is busy', async () => {
    const blocker = net.createServer();
    blockers.push(blocker);
    const busyPort = await listen(blocker);
    const { proxy } = makeProxy();

    const tunnel = await openPortForwardTunnel({
      proxy,
      remotePort: 3000,
      preferredLocalPort: busyPort,
    });

    try {
      expect(tunnel.localPort).not.toBe(busyPort);
      await expect(roundTrip(tunnel.localPort, 'ok')).resolves.toBe('remote:ok');
    } finally {
      await tunnel.close();
    }
  });

  it('closes local sockets without an uncaught exception when the remote port refuses connections', async () => {
    const error = new Error('(SSH) Channel open failure: Connection refused');
    const { proxy } = makeRejectingProxy(error);
    const connectionErrors: string[] = [];
    const uncaughtErrors: string[] = [];
    const onUncaught = (uncaught: Error) => {
      uncaughtErrors.push(uncaught.message);
    };
    process.once('uncaughtException', onUncaught);

    const tunnel = await openPortForwardTunnel({
      proxy,
      remotePort: 5173,
      onConnectionError: (error) => connectionErrors.push(error.message),
    });

    try {
      await connectUntilClosed(tunnel.localPort);
      await new Promise((resolve) => setImmediate(resolve));

      expect(connectionErrors).toEqual(['(SSH) Channel open failure: Connection refused']);
      expect(uncaughtErrors).toEqual([]);
    } finally {
      process.removeListener('uncaughtException', onUncaught);
      await tunnel.close();
    }
  });
});
