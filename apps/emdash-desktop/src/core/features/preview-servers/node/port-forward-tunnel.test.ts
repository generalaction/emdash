import { once } from 'node:events';
import { createServer, connect, type Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  SshClientProxy,
  SshPortForward,
} from '@core/primitives/ssh/api/node/ssh-client-proxy';
import { openPortForwardTunnel } from './port-forward-tunnel';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function forwardingProxy(respond = true) {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    if (respond) socket.pipe(socket);
    else socket.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  let resolveClosed!: (error?: Error) => void;
  const closed = new Promise<Error | undefined>((resolve) => {
    resolveClosed = resolve;
  });
  const close = vi.fn(async () => {
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    resolveClosed();
  });
  cleanup.push(close);
  const forward: SshPortForward = { localPort: address.port, closed, close };
  const proxy = { isConnected: true, forwardPort: vi.fn(async () => forward) } satisfies Pick<
    SshClientProxy,
    'forwardPort' | 'isConnected'
  >;
  return { proxy, close, resolveClosed, forward };
}
describe('preview transport through managed OpenSSH forwarding', () => {
  it('shares one forwarding process across browser connections and reports actual traffic', async () => {
    const f = await forwardingProxy();
    const established = vi.fn();
    const tunnel = await openPortForwardTunnel({
      proxy: f.proxy,
      remotePort: 3000,
      onConnectionEstablished: established,
    });
    cleanup.push(tunnel.close);
    expect(f.proxy.forwardPort).toHaveBeenCalledOnce();
    for (let index = 0; index < 2; index++) {
      const socket = connect(tunnel.localPort, '127.0.0.1');
      const data = once(socket, 'data');
      socket.write('preview');
      expect((await data)[0].toString()).toBe('preview');
      socket.destroy();
    }
    expect(f.proxy.forwardPort).toHaveBeenCalledOnce();
    expect(established).toHaveBeenCalledTimes(2);
  });
  it('propagates forward acquisition failures', async () => {
    const proxy = {
      isConnected: true,
      forwardPort: vi.fn(async () => {
        throw new Error('Authentication failed');
      }),
    };
    await expect(openPortForwardTunnel({ proxy, remotePort: 3000 })).rejects.toThrow(
      'Authentication failed'
    );
  });
  it('closes a forward acquired after cancellation', async () => {
    const f = await forwardingProxy();
    let resolve!: (forward: SshPortForward) => void;
    f.proxy.forwardPort.mockImplementation(
      () =>
        new Promise((yes) => {
          resolve = yes;
        })
    );
    const controller = new AbortController();
    const pending = openPortForwardTunnel({
      proxy: f.proxy,
      remotePort: 3000,
      signal: controller.signal,
    });
    const rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(f.proxy.forwardPort).toHaveBeenCalledOnce());
    controller.abort();
    await rejected;
    resolve(f.forward);
    await vi.waitFor(() => expect(f.close).toHaveBeenCalledOnce());
  });
  it('propagates process loss and closes the local listener', async () => {
    const f = await forwardingProxy();
    const error = vi.fn();
    const tunnel = await openPortForwardTunnel({
      proxy: f.proxy,
      remotePort: 3000,
      onConnectionError: error,
    });
    cleanup.push(tunnel.close);
    f.resolveClosed(new Error('SSH disconnected'));
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: 'SSH disconnected' }))
    );
  });
  it('keeps advisory probes out of the data path', async () => {
    const f = await forwardingProxy();
    const probe = vi.fn(() => new Promise<never>(() => {}));
    const tunnel = await openPortForwardTunnel({ proxy: f.proxy, remotePort: 3000, probe });
    cleanup.push(tunnel.close);
    expect(probe).toHaveBeenCalledWith(3000);
    expect(tunnel.localPort).toBeGreaterThan(0);
  });
  it('does not acquire a forward for an already cancelled request', async () => {
    const f = await forwardingProxy();
    await expect(
      openPortForwardTunnel({ proxy: f.proxy, remotePort: 3000, signal: AbortSignal.abort() })
    ).rejects.toThrow();
    expect(f.proxy.forwardPort).not.toHaveBeenCalled();
  });
});

it('falls back from an occupied preferred port and keeps forwarding traffic', async () => {
  const f = await forwardingProxy();
  const tunnel = await openPortForwardTunnel({
    proxy: f.proxy,
    remotePort: 3000,
    preferredLocalPort: f.forward.localPort,
  });
  cleanup.push(tunnel.close);
  expect(tunnel.localPort).not.toBe(f.forward.localPort);
  const socket = connect(tunnel.localPort, '127.0.0.1');
  try {
    const data = once(socket, 'data');
    socket.write('still usable');
    expect((await data)[0].toString()).toBe('still usable');
  } finally {
    socket.destroy();
  }
});
it('reports a remote refusal instead of declaring an empty TCP connection healthy', async () => {
  const f = await forwardingProxy(false);
  const error = vi.fn();
  const established = vi.fn();
  const tunnel = await openPortForwardTunnel({
    proxy: f.proxy,
    remotePort: 3000,
    onConnectionError: error,
    onConnectionEstablished: established,
  });
  cleanup.push(tunnel.close);
  const socket = connect(tunnel.localPort, '127.0.0.1');
  try {
    await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
  } finally {
    socket.destroy();
  }
  expect(established).not.toHaveBeenCalled();
});
it('closes active browser sockets when the tunnel is disposed', async () => {
  const f = await forwardingProxy();
  const tunnel = await openPortForwardTunnel({ proxy: f.proxy, remotePort: 3000 });
  cleanup.push(tunnel.close);
  const socket = connect(tunnel.localPort, '127.0.0.1');
  await once(socket, 'connect');
  const closed = once(socket, 'close');
  await tunnel.close();
  await closed;
  expect(f.close).toHaveBeenCalledOnce();
});
