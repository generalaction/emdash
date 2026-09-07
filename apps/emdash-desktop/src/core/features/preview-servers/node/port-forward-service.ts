import { createScope, type Scope } from '@emdash/shared/concurrency';
import { waitWithSignal } from '@emdash/shared/scheduling';
import type { SshClientProxy } from '@core/primitives/ssh/api/node/ssh-client-proxy';
import {
  openPortForwardTunnel,
  type OpenPortForwardTunnelOptions,
  type PortForwardProbe,
  type PortForwardProbeResult,
  type PortForwardTunnel,
} from './port-forward-tunnel';

export type OpenPortForwardRequest = {
  id: string;
  projectId: string;
  workspaceId: string;
  connectionId: string;
  proxy: Pick<SshClientProxy, 'openTcpChannel' | 'isConnected'>;
  remotePort: number;
  preferredLocalPort?: number;
  probe?: PortForwardProbe;
};

export type PortForwardRecord = {
  id: string;
  projectId: string;
  workspaceId: string;
  connectionId: string;
  remotePort: number;
  localPort: number;
};

type PortForwardEntry = {
  id: string;
  projectId: string;
  workspaceId: string;
  scope: Scope;
  ready: Promise<PortForwardRecord>;
};

export type PortForwardConnectionErrorHandler = (id: string, error: Error) => void;
export type PortForwardProbeResultHandler = (id: string, result: PortForwardProbeResult) => void;
export type PortForwardConnectionEstablishedHandler = (id: string) => void;

export class PortForwardService {
  private readonly tunnels = new Map<string, PortForwardEntry>();
  private readonly openTunnel: (
    request: OpenPortForwardTunnelOptions
  ) => Promise<PortForwardTunnel>;
  private readonly onTunnelClosed?: (id: string) => void;
  private readonly connectionErrorHandlers = new Set<PortForwardConnectionErrorHandler>();
  private readonly probeResultHandlers = new Set<PortForwardProbeResultHandler>();
  private readonly connectionEstablishedHandlers =
    new Set<PortForwardConnectionEstablishedHandler>();

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

  onProbeResult(handler: PortForwardProbeResultHandler): () => void {
    this.probeResultHandlers.add(handler);
    return () => this.probeResultHandlers.delete(handler);
  }

  onConnectionEstablished(handler: PortForwardConnectionEstablishedHandler): () => void {
    this.connectionEstablishedHandlers.add(handler);
    return () => this.connectionEstablishedHandlers.delete(handler);
  }

  async open(request: OpenPortForwardRequest): Promise<PortForwardRecord> {
    const existing = this.tunnels.get(request.id);
    if (existing) return existing.ready;

    const scope = createScope({ label: `port-forward:${request.id}` });
    const entry: PortForwardEntry = {
      id: request.id,
      projectId: request.projectId,
      workspaceId: request.workspaceId,
      scope,
      ready: Promise.resolve().then(async () => {
        scope.signal.throwIfAborted();
        const pending = this.openTunnel({
          proxy: request.proxy,
          signal: scope.signal,
          remotePort: request.remotePort,
          preferredLocalPort: request.preferredLocalPort,
          onConnectionError: (error) => {
            if (isCurrent()) this.emitConnectionError(request.id, error);
          },
          probe: request.probe,
          onProbeResult: (result) => {
            if (isCurrent()) this.emitProbeResult(request.id, result);
          },
          onConnectionEstablished: () => {
            if (isCurrent()) this.emitConnectionEstablished(request.id);
          },
        }).then(async (tunnel) => {
          // Also covers adapters that complete after cancellation instead of honoring the signal.
          if (scope.signal.aborted) {
            await tunnel.close();
            scope.signal.throwIfAborted();
          }
          scope.add(() => tunnel.close());
          return tunnel;
        });
        const tunnel = await waitWithSignal(pending, scope.signal);
        return {
          id: request.id,
          projectId: request.projectId,
          workspaceId: request.workspaceId,
          connectionId: request.connectionId,
          remotePort: request.remotePort,
          localPort: tunnel.localPort,
        };
      }),
    };
    const isCurrent = () => this.tunnels.get(request.id) === entry && !scope.signal.aborted;
    this.tunnels.set(request.id, entry);
    try {
      return await entry.ready;
    } catch (error) {
      if (this.tunnels.get(request.id) === entry) this.tunnels.delete(request.id);
      await scope.dispose();
      throw error;
    }
  }

  async stop(id: string): Promise<void> {
    const entry = this.tunnels.get(id);
    if (!entry) return;
    this.tunnels.delete(id);
    await entry.scope.dispose();
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

  private emitProbeResult(id: string, result: PortForwardProbeResult): void {
    for (const handler of this.probeResultHandlers) {
      handler(id, result);
    }
  }

  private emitConnectionEstablished(id: string): void {
    for (const handler of this.connectionEstablishedHandlers) {
      handler(id);
    }
  }
}
