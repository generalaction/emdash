import type { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import {
  openPortForwardTunnel,
  type OpenPortForwardTunnelOptions,
  type PortForwardTunnel,
} from './port-forward-tunnel';

export type OpenPortForwardRequest = {
  id: string;
  projectId: string;
  workspaceId: string;
  connectionId: string;
  proxy: Pick<SshClientProxy, 'client' | 'isConnected'>;
  remotePort: number;
  preferredLocalPort?: number;
};

export type PortForwardRecord = {
  id: string;
  projectId: string;
  workspaceId: string;
  connectionId: string;
  remotePort: number;
  localPort: number;
};

type PortForwardEntry = PortForwardRecord & {
  tunnel: PortForwardTunnel;
};

export type PortForwardConnectionErrorHandler = (id: string, error: Error) => void;

export class PortForwardService {
  private readonly tunnels = new Map<string, PortForwardEntry>();
  private readonly openTunnel: (
    request: OpenPortForwardTunnelOptions
  ) => Promise<PortForwardTunnel>;
  private readonly onTunnelClosed?: (id: string) => void;
  private readonly connectionErrorHandlers = new Set<PortForwardConnectionErrorHandler>();

  constructor(
    options: {
      openTunnel?: (request: OpenPortForwardTunnelOptions) => Promise<PortForwardTunnel>;
      onTunnelClosed?: (id: string) => void;
      onConnectionError?: PortForwardConnectionErrorHandler;
    } = {}
  ) {
    this.openTunnel = options.openTunnel ?? openPortForwardTunnel;
    this.onTunnelClosed = options.onTunnelClosed;
    if (options.onConnectionError) {
      this.connectionErrorHandlers.add(options.onConnectionError);
    }
  }

  onConnectionError(handler: PortForwardConnectionErrorHandler): () => void {
    this.connectionErrorHandlers.add(handler);
    return () => this.connectionErrorHandlers.delete(handler);
  }

  async open(request: OpenPortForwardRequest): Promise<PortForwardRecord> {
    const existing = this.tunnels.get(request.id);
    if (existing) return toRecord(existing);

    const tunnel = await this.openTunnel({
      proxy: request.proxy,
      remotePort: request.remotePort,
      preferredLocalPort: request.preferredLocalPort,
      onConnectionError: (error) => this.emitConnectionError(request.id, error),
    });
    const entry: PortForwardEntry = {
      id: request.id,
      projectId: request.projectId,
      workspaceId: request.workspaceId,
      connectionId: request.connectionId,
      remotePort: request.remotePort,
      localPort: tunnel.localPort,
      tunnel,
    };
    this.tunnels.set(request.id, entry);
    return toRecord(entry);
  }

  async stop(id: string): Promise<void> {
    const entry = this.tunnels.get(id);
    if (!entry) return;
    this.tunnels.delete(id);
    await entry.tunnel.close();
    this.onTunnelClosed?.(id);
  }

  async stopForWorkspace(projectId: string, workspaceId: string): Promise<void> {
    const ids = Array.from(this.tunnels.values())
      .filter((entry) => entry.projectId === projectId && entry.workspaceId === workspaceId)
      .map((entry) => entry.id);
    await Promise.all(ids.map((id) => this.stop(id)));
  }

  async stopForProject(projectId: string): Promise<void> {
    const ids = Array.from(this.tunnels.values())
      .filter((entry) => entry.projectId === projectId)
      .map((entry) => entry.id);
    await Promise.all(ids.map((id) => this.stop(id)));
  }

  private emitConnectionError(id: string, error: Error): void {
    for (const handler of this.connectionErrorHandlers) {
      handler(id, error);
    }
  }
}

function toRecord(entry: PortForwardEntry): PortForwardRecord {
  return {
    id: entry.id,
    projectId: entry.projectId,
    workspaceId: entry.workspaceId,
    connectionId: entry.connectionId,
    remotePort: entry.remotePort,
    localPort: entry.localPort,
  };
}
