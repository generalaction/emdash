import net from 'node:net';
import type { ClientChannel } from 'ssh2';
import type { SshClientProxy } from '@core/services/ssh/node/lifecycle/ssh-client-proxy';

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

export type OpenPortForwardTunnelOptions = {
  proxy: Pick<SshClientProxy, 'client' | 'isConnected'>;
  remotePort: number;
  preferredLocalPort?: number;
  onConnectionError?: (error: Error) => void;
};

export async function openPortForwardTunnel(
  options: OpenPortForwardTunnelOptions
): Promise<PortForwardTunnel> {
  try {
    return await bindTunnel(options, options.preferredLocalPort ?? 0);
  } catch (error) {
    if (options.preferredLocalPort !== undefined && isAddressInUse(error)) {
      return await bindTunnel(options, 0);
    }
    throw error;
  }
}

function bindTunnel(
  options: OpenPortForwardTunnelOptions,
  localPort: number
): Promise<PortForwardTunnel> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    forwardSocket(socket, options);
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

function forwardSocket(socket: net.Socket, options: OpenPortForwardTunnelOptions): void {
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
    const remoteHost = REMOTE_TARGET_HOSTS[index];
    client.forwardOut(
      LOCAL_BIND_HOST,
      0,
      remoteHost,
      options.remotePort,
      (error: Error | undefined, channel: ClientChannel) => {
        if (error) {
          firstError = firstError ?? error;
          if (index + 1 < REMOTE_TARGET_HOSTS.length && isConnectFailure(error)) {
            tryTargetHost(index + 1);
            return;
          }
          options.onConnectionError?.(firstError);
          socket.destroy();
          return;
        }

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
