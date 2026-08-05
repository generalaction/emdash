import net from 'node:net';
import type { Client, ClientChannel } from 'ssh2';
import type { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import { log } from '@main/lib/logger';

const REMOTE_BIND_HOST = '127.0.0.1';
const LOCAL_HOOK_HOST = '127.0.0.1';

export type HookTunnelProxy = Pick<SshClientProxy, 'client' | 'isConnected' | 'connectionId'>;

type TunnelEntry = {
  client: Client;
  remotePort: Promise<number | null>;
};

function pipeToHookServer(channel: ClientChannel, hookPort: number): void {
  const socket = net.connect(hookPort, LOCAL_HOOK_HOST);
  socket.on('error', () => channel.destroy());
  channel.on('error', () => socket.destroy());
  socket.pipe(channel).pipe(socket);
}

/**
 * Reverse SSH tunnels that let a remote agent CLI reach the local hook server.
 *
 * The hook payloads agents run target `http://127.0.0.1:$EMDASH_HOOK_PORT/hook`
 * (see `packages/core/src/agents/plugins/helpers/hooks.ts`) and the hook server
 * only listens on the desktop machine's loopback. Binding a remote loopback port
 * and piping it back over the existing ssh2 connection is what makes that URL
 * resolve from the remote box, without changing the hook layer itself.
 *
 * One tunnel per SSH connection is enough, since EMDASH_PTY_ID disambiguates
 * conversations. Tunnels die with their connection, so the cache is keyed by
 * connection id and revalidated against the live client on every lookup.
 */
export class RemoteHookTunnelManager {
  private readonly entries = new Map<string, TunnelEntry>();

  /**
   * Returns the remote port that reaches `hookPort` on this machine, or null
   * when the remote refuses port forwarding. A null result is cached for the
   * lifetime of the connection: `AllowTcpForwarding no` will not change under us.
   */
  async ensure(proxy: HookTunnelProxy, hookPort: number): Promise<number | null> {
    if (hookPort <= 0 || !proxy.isConnected) return null;

    let client: Client;
    try {
      client = proxy.client;
    } catch {
      return null;
    }

    const existing = this.entries.get(proxy.connectionId);
    if (existing && existing.client === client) return existing.remotePort;

    const entry: TunnelEntry = { client, remotePort: this.bind(client, hookPort) };
    this.entries.set(proxy.connectionId, entry);
    client.once('close', () => {
      if (this.entries.get(proxy.connectionId) === entry) {
        this.entries.delete(proxy.connectionId);
      }
    });

    return entry.remotePort;
  }

  private bind(client: Client, hookPort: number): Promise<number | null> {
    return new Promise((resolve) => {
      client.forwardIn(REMOTE_BIND_HOST, 0, (error, remotePort) => {
        if (error) {
          log.warn(
            'RemoteHookTunnel: remote refused port forwarding, agent status will not update',
            {
              error: String(error),
            }
          );
          resolve(null);
          return;
        }

        client.on('tcp connection', (details, accept) => {
          if (details.destPort !== remotePort) return;
          pipeToHookServer(accept(), hookPort);
        });

        log.info('RemoteHookTunnel: bound remote hook port', { remotePort, hookPort });
        resolve(remotePort);
      });
    });
  }
}

export const remoteHookTunnels = new RemoteHookTunnelManager();
