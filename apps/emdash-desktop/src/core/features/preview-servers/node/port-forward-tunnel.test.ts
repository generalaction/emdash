import { once } from 'node:events';
import net from 'node:net';
import { Transform } from 'node:stream';
import { deferred } from '@emdash/shared/testing';
import type { ClientChannel } from 'ssh2';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SshTcpTarget } from '@core/primitives/ssh/api/node/ssh-client-proxy';
import { openPortForwardTunnel, type PortForwardProbeResult } from './port-forward-tunnel';

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

describe('channel ownership', () => {
  it('cancels a listener while it is binding', async () => {
    const controller = new AbortController();
    const pending = openPortForwardTunnel({
      remotePort: 5173,
      proxy: makeProxy().proxy,
      signal: controller.signal,
    });
    controller.abort(new Error('stopped during bind'));
    await expect(pending).rejects.toThrow('stopped during bind');
  });

  it.each(['socket', 'tunnel'] as const)(
    'cancels acquisition when the %s closes',
    async (owner) => {
      let finish!: (channel: ClientChannel) => void;
      let openingSignal!: AbortSignal;
      const established = vi.fn();
      const failed = vi.fn();
      const started = deferred<void>();
      const tunnel = await openPortForwardTunnel({
        remotePort: 5173,
        onConnectionEstablished: established,
        onConnectionError: failed,
        proxy: {
          isConnected: true,
          openTcpChannel: (_target, options) => {
            openingSignal = options!.signal!;
            started.resolve();
            // Deliberately ignores cancellation to exercise the ownership handoff race.
            return new Promise((resolve) => {
              finish = resolve;
            });
          },
        },
      });
      const socket = net.connect(tunnel.localPort, '127.0.0.1');
      socket.on('error', () => {});
      try {
        await started.promise;
        const aborted = new Promise<void>((resolve) =>
          openingSignal.addEventListener('abort', () => resolve(), { once: true })
        );
        if (owner === 'socket') socket.destroy();
        else await tunnel.close();
        await aborted;
        const channel = new EchoChannel();
        const closed = once(channel, 'close');
        finish(channel as unknown as ClientChannel);
        await closed;
        expect(channel.destroyed).toBe(true);
        expect(established).not.toHaveBeenCalled();
        expect(failed).not.toHaveBeenCalled();
      } finally {
        socket.destroy();
        await tunnel.close();
      }
    }
  );

  it('destroys an established channel when its tunnel closes', async () => {
    const channel = new EchoChannel();
    const established = deferred<void>();
    const tunnel = await openPortForwardTunnel({
      remotePort: 5173,
      proxy: { isConnected: true, openTcpChannel: async () => channel as unknown as ClientChannel },
      onConnectionEstablished: () => established.resolve(),
    });
    const socket = net.connect(tunnel.localPort, '127.0.0.1');
    socket.on('error', () => {});
    try {
      await established.promise;
      await tunnel.close();
      expect(channel.destroyed).toBe(true);
    } finally {
      socket.destroy();
      await tunnel.close();
    }
  });

  it('ignores advisory results after closure', async () => {
    const probe = deferred<PortForwardProbeResult>();
    const reported = vi.fn();
    const tunnel = await openPortForwardTunnel({
      remotePort: 5173,
      proxy: makeProxy().proxy,
      probe: () => probe.promise,
      onProbeResult: reported,
    });
    await tunnel.close();
    probe.resolve({ listening: true, families: ['ipv6'] });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(reported).not.toHaveBeenCalled();
  });
});

function channelOpenError(message: string, reason: number): Error {
  const error = new Error(message);
  (error as { reason?: number }).reason = reason;
  return error;
}

function makeProxy() {
  const calls: SshTcpTarget[] = [];
  return {
    calls,
    proxy: {
      isConnected: true,
      async openTcpChannel(target: SshTcpTarget) {
        calls.push(target);
        return new EchoChannel() as unknown as ClientChannel;
      },
    },
  };
}

function makeRejectingProxy(error: Error) {
  return {
    proxy: {
      isConnected: true,
      async openTcpChannel() {
        throw error;
      },
    },
  };
}

function makeFamilyAwareProxy(reachableHost: string) {
  const calls: Array<{ remoteHost: string; remotePort: number }> = [];
  return {
    calls,
    proxy: {
      isConnected: true,
      async openTcpChannel({ remoteHost, remotePort }: SshTcpTarget) {
        calls.push({ remoteHost, remotePort });
        if (remoteHost === reachableHost) return new EchoChannel() as unknown as ClientChannel;
        throw channelOpenError('(SSH) Channel open failure: Connection refused', 2);
      },
    },
  };
}

function makePerHostFailingProxy(errors: Record<string, Error>) {
  const calls: Array<{ remoteHost: string; remotePort: number }> = [];
  return {
    calls,
    proxy: {
      isConnected: true,
      async openTcpChannel({ remoteHost, remotePort }: SshTcpTarget) {
        calls.push({ remoteHost, remotePort });
        throw errors[remoteHost] ?? channelOpenError('(SSH) Channel open failure: unexpected', 2);
      },
    },
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

  it('falls back to the IPv6 loopback when the IPv4 target refuses', async () => {
    const { proxy, calls } = makeFamilyAwareProxy('::1');

    const tunnel = await openPortForwardTunnel({
      proxy,
      remotePort: 5173,
    });

    try {
      await expect(roundTrip(tunnel.localPort, 'ping')).resolves.toBe('remote:ping');
      expect(calls).toEqual([
        { remoteHost: '127.0.0.1', remotePort: 5173 },
        { remoteHost: '::1', remotePort: 5173 },
      ]);
    } finally {
      await tunnel.close();
    }
  });

  it('does not fall back to the other family when the remote rejects for a non-connect reason', async () => {
    const { proxy, calls } = makePerHostFailingProxy({
      '127.0.0.1': channelOpenError('(SSH) Channel open failure: administratively prohibited', 1),
    });
    const connectionErrors: string[] = [];

    const tunnel = await openPortForwardTunnel({
      proxy,
      remotePort: 5173,
      onConnectionError: (error) => connectionErrors.push(error.message),
    });

    try {
      await connectUntilClosed(tunnel.localPort);
      await new Promise((resolve) => setImmediate(resolve));

      expect(calls).toEqual([{ remoteHost: '127.0.0.1', remotePort: 5173 }]);
      expect(connectionErrors).toEqual(['(SSH) Channel open failure: administratively prohibited']);
    } finally {
      await tunnel.close();
    }
  });

  it('surfaces the first error when every loopback family fails to connect', async () => {
    const { proxy, calls } = makePerHostFailingProxy({
      '127.0.0.1': channelOpenError('(SSH) Channel open failure: Connection refused [ipv4]', 2),
      '::1': channelOpenError('(SSH) Channel open failure: Connection refused [ipv6]', 2),
    });
    const connectionErrors: string[] = [];

    const tunnel = await openPortForwardTunnel({
      proxy,
      remotePort: 5173,
      onConnectionError: (error) => connectionErrors.push(error.message),
    });

    try {
      await connectUntilClosed(tunnel.localPort);
      await new Promise((resolve) => setImmediate(resolve));

      expect(calls).toEqual([
        { remoteHost: '127.0.0.1', remotePort: 5173 },
        { remoteHost: '::1', remotePort: 5173 },
      ]);
      expect(connectionErrors).toEqual(['(SSH) Channel open failure: Connection refused [ipv4]']);
    } finally {
      await tunnel.close();
    }
  });

  describe('advisory probe', () => {
    const flushProbe = () => new Promise((resolve) => setImmediate(resolve));

    it('dials the IPv6 loopback first when the probe reports an IPv6-only listener', async () => {
      const { proxy, calls } = makeFamilyAwareProxy('::1');

      const tunnel = await openPortForwardTunnel({
        proxy,
        remotePort: 5173,
        probe: async () => ({ listening: true, families: ['ipv6'] }),
      });

      try {
        await flushProbe();
        await expect(roundTrip(tunnel.localPort, 'ping')).resolves.toBe('remote:ping');
        expect(calls).toEqual([{ remoteHost: '::1', remotePort: 5173 }]);
      } finally {
        await tunnel.close();
      }
    });

    it('keeps the per-connection family fallback when the probe hint is wrong', async () => {
      const { proxy, calls } = makeFamilyAwareProxy('127.0.0.1');

      const tunnel = await openPortForwardTunnel({
        proxy,
        remotePort: 5173,
        probe: async () => ({ listening: true, families: ['ipv6'] }),
      });

      try {
        await flushProbe();
        await expect(roundTrip(tunnel.localPort, 'ping')).resolves.toBe('remote:ping');
        expect(calls).toEqual([
          { remoteHost: '::1', remotePort: 5173 },
          { remoteHost: '127.0.0.1', remotePort: 5173 },
        ]);
      } finally {
        await tunnel.close();
      }
    });

    it('keeps the default dial order when the probe reports both families', async () => {
      const { proxy, calls } = makeFamilyAwareProxy('127.0.0.1');

      const tunnel = await openPortForwardTunnel({
        proxy,
        remotePort: 5173,
        probe: async () => ({ listening: true, families: ['ipv4', 'ipv6'] }),
      });

      try {
        await flushProbe();
        await expect(roundTrip(tunnel.localPort, 'ping')).resolves.toBe('remote:ping');
        expect(calls).toEqual([{ remoteHost: '127.0.0.1', remotePort: 5173 }]);
      } finally {
        await tunnel.close();
      }
    });

    it('opens the tunnel without waiting when the probe never resolves', async () => {
      const { proxy, calls } = makeProxy();

      const tunnel = await openPortForwardTunnel({
        proxy,
        remotePort: 5173,
        probe: () => new Promise<PortForwardProbeResult>(() => {}),
      });

      try {
        await expect(roundTrip(tunnel.localPort, 'ping')).resolves.toBe('remote:ping');
        expect(calls).toEqual([
          { sourceHost: '127.0.0.1', sourcePort: 0, remoteHost: '127.0.0.1', remotePort: 5173 },
        ]);
      } finally {
        await tunnel.close();
      }
    });

    it('falls back to the blind dual-family dial when the probe rejects', async () => {
      const { proxy, calls } = makeFamilyAwareProxy('::1');
      const probeResults: PortForwardProbeResult[] = [];

      const tunnel = await openPortForwardTunnel({
        proxy,
        remotePort: 5173,
        probe: async () => {
          throw new Error('probe unavailable');
        },
        onProbeResult: (result) => probeResults.push(result),
      });

      try {
        await flushProbe();
        await expect(roundTrip(tunnel.localPort, 'ping')).resolves.toBe('remote:ping');
        expect(calls).toEqual([
          { remoteHost: '127.0.0.1', remotePort: 5173 },
          { remoteHost: '::1', remotePort: 5173 },
        ]);
        expect(probeResults).toEqual([]);
      } finally {
        await tunnel.close();
      }
    });

    it('opens the tunnel and reports the probe result when nothing is listening', async () => {
      const { proxy } = makeProxy();
      const probeResults: PortForwardProbeResult[] = [];

      const tunnel = await openPortForwardTunnel({
        proxy,
        remotePort: 5173,
        probe: async () => ({ listening: false, families: [] }),
        onProbeResult: (result) => probeResults.push(result),
      });

      try {
        await flushProbe();
        expect(probeResults).toEqual([{ listening: false, families: [] }]);
        await expect(roundTrip(tunnel.localPort, 'ping')).resolves.toBe('remote:ping');
      } finally {
        await tunnel.close();
      }
    });

    it('reports established connections so a stale not-listening state can clear', async () => {
      const { proxy } = makeProxy();
      let established = 0;

      const tunnel = await openPortForwardTunnel({
        proxy,
        remotePort: 5173,
        onConnectionEstablished: () => {
          established += 1;
        },
      });

      try {
        await expect(roundTrip(tunnel.localPort, 'ping')).resolves.toBe('remote:ping');
        await new Promise((resolve) => setImmediate(resolve));
        expect(established).toBe(1);
      } finally {
        await tunnel.close();
      }
    });
  });

  it('closes local sockets without an uncaught exception when the remote port refuses connections', async () => {
    const error = channelOpenError('(SSH) Channel open failure: Connection refused', 2);
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
