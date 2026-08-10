import net from 'node:net';
import type { ClientChannel } from 'ssh2';
import type { SshClientProxy } from '@core/primitives/ssh/api/node/ssh-client-proxy';

const LOCAL_BIND_HOST = '127.0.0.1';
// A dev server may bind to the IPv4 loopback, the IPv6 loopback, or both. A
// process started on the default `localhost` host resolves to `::1` first on
// Node >= 17, so it often listens only on `[::1]`. Dialing a single hardcoded
// `127.0.0.1` misses it. Try both loopback families per connection.
const REMOTE_TARGET_HOSTS = ['127.0.0.1', '::1'] as const;
// ssh2 attaches the SSH channel-open failure reason code (RFC 4254) to errors
// from `forwardOut`. `SSH_OPEN_CONNECT_FAILED` means the remote could not
// connect to the requested destination, which is the only retryable family miss.
const SSH_OPEN_CONNECT_FAILED = 2;

function isConnectFailure(error: Error): boolean {
  return (error as { reason?: number }).reason === SSH_OPEN_CONNECT_FAILED;
}

export type PortForwardTunnel = {
  localPort: number;
  close(): Promise<void>;
};

export type PortForwardProbeFamily = 'ipv4' | 'ipv6';

export type PortForwardProbeResult = {
  listening: boolean;
  families: PortForwardProbeFamily[];
};

/** One-shot advisory inspection of the remote port (workspace-server hosts only). */
export type PortForwardProbe = (remotePort: number) => Promise<PortForwardProbeResult>;

export type OpenPortForwardTunnelOptions = {
  proxy: Pick<SshClientProxy, 'client' | 'isConnected'>;
  remotePort: number;
  preferredLocalPort?: number;
  onConnectionError?: (error: Error) => void;
  probe?: PortForwardProbe;
  onProbeResult?: (result: PortForwardProbeResult) => void;
  onConnectionEstablished?: () => void;
};

type RemoteTargetHost = (typeof REMOTE_TARGET_HOSTS)[number];

/** Mutable dial-order hint; connections read it at connect time, the probe updates it. */
type DialOrder = { current: readonly RemoteTargetHost[] };

const FAMILY_TARGET_HOSTS: Record<PortForwardProbeFamily, RemoteTargetHost> = {
  ipv4: '127.0.0.1',
  ipv6: '::1',
};

export async function openPortForwardTunnel(
  options: OpenPortForwardTunnelOptions
): Promise<PortForwardTunnel> {
  const dialOrder = startAdvisoryProbe(options);
  try {
    return await bindTunnel(options, options.preferredLocalPort ?? 0, dialOrder);
  } catch (error) {
    if (options.preferredLocalPort !== undefined && isAddressInUse(error)) {
      return await bindTunnel(options, 0, dialOrder);
    }
    throw error;
  }
}

/**
 * Fires the one-shot advisory probe. Its promise is intentionally never
 * awaited by the bind or dial path: a slow, failing, or absent probe leaves
 * behavior exactly at today's blind dual-family dial.
 */
function startAdvisoryProbe(options: OpenPortForwardTunnelOptions): DialOrder {
  const dialOrder: DialOrder = { current: REMOTE_TARGET_HOSTS };
  const probe = options.probe;
  if (!probe) return dialOrder;

  void Promise.resolve()
    .then(() => probe(options.remotePort))
    .then((result) => {
      dialOrder.current = orderTargetHosts(result.families);
      options.onProbeResult?.(result);
    })
    .catch(() => {});

  return dialOrder;
}

function orderTargetHosts(families: PortForwardProbeFamily[]): readonly RemoteTargetHost[] {
  const listening = new Set(families.map((family) => FAMILY_TARGET_HOSTS[family]));
  if (listening.size === 0) return REMOTE_TARGET_HOSTS;
  // Listening families dial first; both stay in the list so the existing
  // per-connection fallback covers a wrong or stale hint.
  return [...REMOTE_TARGET_HOSTS].sort(
    (a, b) => Number(listening.has(b)) - Number(listening.has(a))
  );
}

function bindTunnel(
  options: OpenPortForwardTunnelOptions,
  localPort: number,
  dialOrder: DialOrder
): Promise<PortForwardTunnel> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    forwardSocket(socket, options, dialOrder.current);
  });

  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.removeListener('listening', onListening);
      reject(error);
    };

    const onListening = () => {
      server.removeListener('error', onError);
      const address = server.address();
      if (typeof address !== 'object' || address === null) {
        reject(new Error('port forward listener did not bind to a TCP address'));
        return;
      }

      resolve({
        localPort: address.port,
        close: async () => {
          for (const socket of sockets) socket.destroy();
          await closeServer(server);
        },
      });
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen({ host: LOCAL_BIND_HOST, port: localPort });
  });
}

function forwardSocket(
  socket: net.Socket,
  options: OpenPortForwardTunnelOptions,
  targetHosts: readonly RemoteTargetHost[]
): void {
  if (!options.proxy.isConnected) {
    socket.destroy();
    return;
  }

  let client;
  try {
    client = options.proxy.client;
  } catch {
    socket.destroy();
    return;
  }

  let firstError: Error | undefined;

  const tryTargetHost = (index: number): void => {
    const remoteHost = targetHosts[index];
    client.forwardOut(
      LOCAL_BIND_HOST,
      0,
      remoteHost,
      options.remotePort,
      (error: Error | undefined, channel: ClientChannel) => {
        if (error) {
          firstError = firstError ?? error;
          if (index + 1 < targetHosts.length && isConnectFailure(error)) {
            tryTargetHost(index + 1);
            return;
          }
          options.onConnectionError?.(firstError);
          socket.destroy();
          return;
        }

        options.onConnectionEstablished?.();
        socket.on('error', () => channel.destroy());
        channel.on('error', (channelError: Error) => {
          options.onConnectionError?.(channelError);
          socket.destroy();
        });
        socket.pipe(channel).pipe(socket);
      }
    );
  };

  tryTargetHost(0);
}

function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function isAddressInUse(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'EADDRINUSE'
  );
}
