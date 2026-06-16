import net from 'node:net';
import type { ClientChannel } from 'ssh2';
import type { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';

const LOCAL_BIND_HOST = '127.0.0.1';
const REMOTE_TARGET_HOST = '127.0.0.1';

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

  client.forwardOut(
    LOCAL_BIND_HOST,
    0,
    REMOTE_TARGET_HOST,
    options.remotePort,
    (error: Error | undefined, channel: ClientChannel) => {
      if (error) {
        options.onConnectionError?.(error);
        socket.destroy();
        return;
      }

      socket.on('error', () => channel.destroy());
      channel.on('error', (error: Error) => {
        options.onConnectionError?.(error);
        socket.destroy();
      });
      socket.pipe(channel).pipe(socket);
    }
  );
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
