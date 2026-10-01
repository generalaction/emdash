import net from 'node:net';
import { createScope, type Scope } from '@emdash/shared/concurrency';
import { abortableWait, waitWithSignal } from '@emdash/shared/scheduling';
import type { SshClientProxy } from '@core/primitives/ssh/api/node/ssh-client-proxy';

const LOCAL_BIND_HOST = '127.0.0.1';
export type PortForwardTunnel = { localPort: number; close(): Promise<void> };
export type PortForwardProbeFamily = 'ipv4' | 'ipv6';
export type PortForwardProbeResult = { listening: boolean; families: PortForwardProbeFamily[] };
export type PortForwardProbe = (remotePort: number) => Promise<PortForwardProbeResult>;
export type OpenPortForwardTunnelOptions = {
  proxy: Pick<SshClientProxy, 'forwardPort' | 'isConnected'>;
  remotePort: number;
  signal?: AbortSignal;
  preferredLocalPort?: number;
  onConnectionError?: (error: Error) => void;
  probe?: PortForwardProbe;
  onProbeResult?: (result: PortForwardProbeResult) => void;
  onConnectionEstablished?: () => void;
};

/** Owns a preview listener and one SSH forward. Traffic observation remains a preview concern. */
export async function openPortForwardTunnel(
  options: OpenPortForwardTunnelOptions
): Promise<PortForwardTunnel> {
  options.signal?.throwIfAborted();
  if (!options.proxy.isConnected) throw new Error('SSH is disconnected');
  const scope = createScope({ label: 'port-forward-tunnel' });
  const abort = () => {
    void scope.dispose(options.signal?.reason);
  };
  options.signal?.addEventListener('abort', abort, { once: true });
  scope.add(() => options.signal?.removeEventListener('abort', abort));
  if (options.signal?.aborted) abort();
  if (options.probe) {
    void Promise.resolve()
      .then(() => (scope.signal.aborted ? undefined : options.probe!(options.remotePort)))
      .then((result) => {
        if (result && !scope.signal.aborted) options.onProbeResult?.(result);
      })
      .catch(() => {});
  }
  try {
    scope.signal.throwIfAborted();
    const pending = options.proxy.forwardPort(options.remotePort, { signal: scope.signal });
    void pending.then(
      (forward) => {
        if (scope.disposed) void forward.close();
      },
      () => {}
    );
    const forward = await waitWithSignal(pending, scope.signal);
    scope.add(() => forward.close());
    void forward.closed.then((error) => {
      if (scope.disposed) return;
      options.onConnectionError?.(error ?? new Error('SSH preview forward closed'));
      void scope.dispose(error);
    });
    try {
      return await bindTunnel(options, options.preferredLocalPort ?? 0, forward.localPort, scope);
    } catch (error) {
      if (
        !scope.signal.aborted &&
        options.preferredLocalPort !== undefined &&
        (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
      ) {
        return await bindTunnel(options, 0, forward.localPort, scope);
      }
      throw error;
    }
  } catch (error) {
    await scope.dispose();
    throw error;
  }
}

function bindTunnel(
  options: OpenPortForwardTunnelOptions,
  localPort: number,
  forwardedPort: number,
  scope: Scope
): Promise<PortForwardTunnel> {
  return abortableWait({ signal: scope.signal }, ({ resolve, reject }) => {
    const server = net.createServer((client) => {
      const owner = scope.child('forwarded-socket');
      const remote = net.connect({ host: LOCAL_BIND_HOST, port: forwardedPort });
      owner.add(() => {
        client.destroy();
        remote.destroy();
      });
      client.once('close', () => {
        void owner.dispose();
      });
      client.on('error', () => {
        void owner.dispose();
      });
      let received = false;
      remote.once('data', () => {
        received = true;
        if (!owner.signal.aborted) options.onConnectionEstablished?.();
      });
      remote.on('error', (error) => {
        if (!owner.signal.aborted) options.onConnectionError?.(error);
        void owner.dispose();
      });
      remote.once('end', () => {
        if (!received && !owner.signal.aborted)
          options.onConnectionError?.(
            new Error(`Remote preview port ${options.remotePort} closed without responding`)
          );
      });
      remote.once('close', () => {
        void owner.dispose();
      });
      client.pipe(remote).pipe(client);
    });
    server.on('error', reject);
    scope.add(() => closeServer(server));
    server.once('listening', () => {
      if (scope.signal.aborted) {
        void closeServer(server);
        return;
      }
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Preview listener did not bind to a TCP address'));
        return;
      }
      resolve({ localPort: address.port, close: () => scope.dispose() });
    });
    server.listen({ host: LOCAL_BIND_HOST, port: localPort, signal: scope.signal });
  });
}

async function closeServer(server: net.Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => {
      if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING')
        reject(error);
      else resolve();
    })
  );
}
