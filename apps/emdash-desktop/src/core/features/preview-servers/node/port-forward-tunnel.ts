import net from 'node:net';
import { createScope, type Scope } from '@emdash/shared/concurrency';
import { abortableWait } from '@emdash/shared/scheduling';
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
  proxy: Pick<SshClientProxy, 'openTcpChannel' | 'isConnected'>;
  remotePort: number;
  signal?: AbortSignal;
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
  const scope = createScope({ label: 'port-forward-tunnel' });
  const abort = () => {
    void scope.dispose(options.signal?.reason);
  };
  options.signal?.addEventListener('abort', abort, { once: true });
  scope.add(() => options.signal?.removeEventListener('abort', abort));
  if (options.signal?.aborted) abort();
  const ownedOptions = { ...options, signal: scope.signal };
  const dialOrder = startAdvisoryProbe(ownedOptions);
  try {
    try {
      return await bindTunnel(ownedOptions, options.preferredLocalPort ?? 0, dialOrder, scope);
    } catch (error) {
      if (
        !scope.signal.aborted &&
        options.preferredLocalPort !== undefined &&
        isAddressInUse(error)
      ) {
        return await bindTunnel(ownedOptions, 0, dialOrder, scope);
      }
      throw error;
    }
  } catch (error) {
    await scope.dispose();
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
    .then(() => (options.signal?.aborted ? undefined : probe(options.remotePort)))
    .then((result) => {
      if (!result || options.signal?.aborted) return;
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
  dialOrder: DialOrder,
  scope: Scope
): Promise<PortForwardTunnel> {
  return abortableWait({ signal: scope.signal }, ({ resolve, reject }) => {
    const server = net.createServer((socket) => {
      const owner = scope.child('forwarded-socket');
      owner.add(() => {
        socket.destroy();
      });
      socket.once('close', () => {
        void owner.dispose();
      });
      socket.on('error', () => {
        void owner.dispose();
      });
      void forwardSocket(socket, options, dialOrder.current, owner);
    });
    // Keep the error handler for the full listener lifetime, including cancellation during bind.
    server.on('error', reject);
    scope.add(() => closeServer(server));
    server.once('listening', () => {
      if (scope.signal.aborted) {
        void closeServer(server);
        return;
      }
      const address = server.address();
      if (typeof address !== 'object' || address === null) {
        reject(new Error('port forward listener did not bind to a TCP address'));
        return;
      }
      resolve({ localPort: address.port, close: () => scope.dispose() });
    });
    server.listen({ host: LOCAL_BIND_HOST, port: localPort, signal: scope.signal });
  });
}

async function forwardSocket(
  socket: net.Socket,
  options: OpenPortForwardTunnelOptions,
  targetHosts: readonly RemoteTargetHost[],
  owner: Scope
): Promise<void> {
  if (!options.proxy.isConnected) {
    await owner.dispose();
    return;
  }
  let firstError: Error | undefined;
  for (const remoteHost of targetHosts) {
    if (owner.signal.aborted) return;
    try {
      const channel = await options.proxy.openTcpChannel(
        {
          sourceHost: LOCAL_BIND_HOST,
          sourcePort: 0,
          remoteHost,
          remotePort: options.remotePort,
        },
        { signal: owner.signal }
      );
      // Acquisition may finish just before disposal, while this continuation is queued.
      if (owner.signal.aborted || socket.destroyed) {
        channel.destroy();
        return;
      }
      owner.add(() => {
        channel.destroy();
      });
      channel.once('close', () => {
        void owner.dispose();
      });
      channel.on('error', (error: Error) => {
        if (!owner.signal.aborted) options.onConnectionError?.(error);
        void owner.dispose();
      });
      options.onConnectionEstablished?.();
      if (!owner.signal.aborted) socket.pipe(channel).pipe(socket);
      return;
    } catch (cause) {
      if (owner.signal.aborted) return;
      const error = cause instanceof Error ? cause : new Error(String(cause));
      firstError ??= error;
      if (isConnectFailure(error) && remoteHost !== targetHosts.at(-1)) continue;
      options.onConnectionError?.(firstError);
      await owner.dispose();
      return;
    }
  }
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
