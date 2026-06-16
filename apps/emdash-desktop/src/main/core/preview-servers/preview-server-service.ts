import { randomUUID } from 'node:crypto';
import type {
  DirectPreviewServer,
  DirectPreviewServerHost,
  ManualPreviewServerRequest,
  PreviewServer,
  PreviewServerEvent,
  PreviewServerProtocol,
  PreviewServerSource,
} from '@shared/core/preview-servers/types';
import type { ConnectionState } from '@shared/core/ssh/ssh';
import { PortForwardService } from '../port-forwards/port-forward-service';
import type { SshClientProxy } from '../ssh/lifecycle/ssh-client-proxy';
import type { SshConnectionManagerEvent } from '../ssh/lifecycle/ssh-connection-manager';
import type { DetectedPreviewUrl, PreviewSourceClosed } from './terminal-url-detector';

export type RegisterDetectedPreviewTarget =
  | {
      projectId: string;
      workspaceId: string;
      transport: 'local';
      source: PreviewServerSource;
      protocol: PreviewServerProtocol;
      host: DirectPreviewServerHost;
      port: number;
      urlPath: string;
    }
  | {
      projectId: string;
      workspaceId: string;
      transport: 'ssh';
      connectionId: string;
      proxy: Pick<SshClientProxy, 'client' | 'isConnected'>;
      source: PreviewServerSource;
      protocol: PreviewServerProtocol;
      port: number;
      urlPath: string;
    };

export type TerminalSourceClosedInput = {
  projectId: string;
  workspaceId: string;
  terminalId: string;
  transport: 'local' | 'ssh';
  connectionId?: string;
  reason: PreviewSourceClosed['reason'];
  server?: DetectedPreviewUrl;
};

type PreviewMetadata = {
  identity: string;
  tunnelId?: string;
};

export class PreviewServerService {
  private readonly servers = new Map<string, PreviewServer>();
  private readonly identities = new Map<string, string>();
  private readonly metadata = new Map<string, PreviewMetadata>();
  private readonly portForwards: PortForwardService;
  private readonly emit: (event: PreviewServerEvent) => void;
  private readonly getConnectionState: (connectionId: string) => ConnectionState;
  private readonly getSshProxy: (
    connectionId: string
  ) => Promise<Pick<SshClientProxy, 'client' | 'isConnected'>>;
  private readonly closeDelayMs: number;

  constructor({
    portForwards = new PortForwardService(),
    emit,
    getConnectionState,
    getSshProxy,
    closeDelayMs = 250,
  }: {
    portForwards?: PortForwardService;
    emit: (event: PreviewServerEvent) => void;
    getConnectionState: (connectionId: string) => ConnectionState;
    getSshProxy?: (connectionId: string) => Promise<Pick<SshClientProxy, 'client' | 'isConnected'>>;
    closeDelayMs?: number;
  }) {
    this.portForwards = portForwards;
    this.emit = emit;
    this.getConnectionState = getConnectionState;
    this.getSshProxy =
      getSshProxy ??
      (async () => {
        throw new Error('SSH proxy resolver is not configured');
      });
    this.closeDelayMs = closeDelayMs;
  }

  async registerDetectedTarget(target: RegisterDetectedPreviewTarget): Promise<PreviewServer> {
    if (target.transport === 'local') {
      return this.registerLocalTarget(target);
    }

    const identity = sshAutoIdentity(target);
    const existing = this.serverForIdentity(identity);
    if (existing) return existing;

    const tunnelId = `preview:${identity}`;
    const forward = await this.portForwards.open({
      id: tunnelId,
      projectId: target.projectId,
      workspaceId: target.workspaceId,
      connectionId: target.connectionId,
      proxy: target.proxy,
      remotePort: target.port,
      preferredLocalPort: target.port,
    });
    const server: PreviewServer = {
      id: identity,
      kind: 'forwarded',
      projectId: target.projectId,
      workspaceId: target.workspaceId,
      source: target.source,
      protocol: target.protocol,
      urlPath: target.urlPath,
      status: { kind: 'ready' },
      connectionId: target.connectionId,
      remotePort: target.port,
      localPort: forward.localPort,
    };
    this.addServer(identity, server, { identity, tunnelId });
    return server;
  }

  listForWorkspace({
    projectId,
    workspaceId,
  }: {
    projectId: string;
    workspaceId: string;
  }): PreviewServer[] {
    return Array.from(this.servers.values()).filter(
      (server) => server.projectId === projectId && server.workspaceId === workspaceId
    );
  }

  async handleTerminalSourceClosed(input: TerminalSourceClosedInput): Promise<void> {
    if (input.transport === 'local') {
      await this.stopForTerminal(input);
      return;
    }

    if (input.reason !== 'pty-exit' || !input.connectionId) return;
    setTimeout(() => {
      if (this.getConnectionState(input.connectionId!) === 'connected') {
        void this.stopForTerminal(input);
      }
    }, this.closeDelayMs);
  }

  async forwardManual(request: ManualPreviewServerRequest): Promise<PreviewServer> {
    const id = `manual:${randomUUID()}`;
    const tunnelId = `preview:${id}`;
    const proxy = await this.getSshProxy(request.connectionId);
    const forward = await this.portForwards.open({
      id: tunnelId,
      projectId: request.projectId,
      workspaceId: request.workspaceId,
      connectionId: request.connectionId,
      proxy,
      remotePort: request.remotePort,
      preferredLocalPort: request.preferredLocalPort ?? request.remotePort,
    });
    const server: PreviewServer = {
      id,
      kind: 'forwarded',
      projectId: request.projectId,
      workspaceId: request.workspaceId,
      source: { kind: 'manual' },
      protocol: request.protocol,
      urlPath: '/',
      status: { kind: 'ready' },
      connectionId: request.connectionId,
      remotePort: request.remotePort,
      localPort: forward.localPort,
    };
    this.addServer(id, server, { identity: id, tunnelId });
    return server;
  }

  handleSshConnectionEvent(event: Pick<SshConnectionManagerEvent, 'type' | 'connectionId'>): void {
    if (
      event.type !== 'disconnected' &&
      event.type !== 'reconnecting' &&
      event.type !== 'reconnected' &&
      event.type !== 'reconnect-failed'
    ) {
      return;
    }

    for (const server of this.servers.values()) {
      if (server.kind !== 'forwarded' || server.connectionId !== event.connectionId) continue;

      const next =
        event.type === 'disconnected' || event.type === 'reconnecting'
          ? { ...server, status: { kind: 'reconnecting' as const } }
          : event.type === 'reconnected'
            ? { ...server, status: { kind: 'ready' as const } }
            : {
                ...server,
                status: {
                  kind: 'failed' as const,
                  message: 'SSH connection failed to reconnect',
                },
              };

      this.servers.set(next.id, next);
      this.emit({ type: 'upsert', server: next });
    }
  }

  async stop(id: string): Promise<void> {
    const server = this.servers.get(id);
    if (!server) return;
    this.servers.delete(id);
    const metadata = this.metadata.get(id);
    this.metadata.delete(id);
    if (metadata) this.identities.delete(metadata.identity);
    if (metadata?.tunnelId) await this.portForwards.stop(metadata.tunnelId);
    this.emit({ type: 'remove', id });
  }

  async restart(id: string): Promise<PreviewServer | undefined> {
    const server = this.servers.get(id);
    const metadata = this.metadata.get(id);
    if (!server || server.kind !== 'forwarded' || !metadata?.tunnelId) return server;

    await this.portForwards.stop(metadata.tunnelId);
    const proxy = await this.getSshProxy(server.connectionId);
    const forward = await this.portForwards.open({
      id: metadata.tunnelId,
      projectId: server.projectId,
      workspaceId: server.workspaceId,
      connectionId: server.connectionId,
      proxy,
      remotePort: server.remotePort,
      preferredLocalPort: server.localPort,
    });
    const next: PreviewServer = {
      ...server,
      localPort: forward.localPort,
      status: { kind: 'ready' },
    };
    this.servers.set(id, next);
    this.emit({ type: 'upsert', server: next });
    return next;
  }

  async stopForWorkspace(projectId: string, workspaceId: string): Promise<void> {
    const ids = Array.from(this.servers.values())
      .filter((server) => server.projectId === projectId && server.workspaceId === workspaceId)
      .map((server) => server.id);
    await Promise.all(ids.map((id) => this.stop(id)));
  }

  async stopForProject(projectId: string): Promise<void> {
    const ids = Array.from(this.servers.values())
      .filter((server) => server.projectId === projectId)
      .map((server) => server.id);
    await Promise.all(ids.map((id) => this.stop(id)));
  }

  private registerLocalTarget(
    target: Extract<RegisterDetectedPreviewTarget, { transport: 'local' }>
  ): DirectPreviewServer {
    const identity = localAutoIdentity(target);
    const existing = this.serverForIdentity(identity);
    if (existing) return existing as DirectPreviewServer;

    const server: DirectPreviewServer = {
      id: identity,
      kind: 'direct',
      projectId: target.projectId,
      workspaceId: target.workspaceId,
      source: target.source,
      protocol: target.protocol,
      urlPath: target.urlPath,
      status: { kind: 'ready' },
      host: target.host,
      port: target.port,
    };
    this.addServer(identity, server, { identity });
    return server;
  }

  private async stopForTerminal(input: {
    projectId: string;
    workspaceId: string;
    terminalId: string;
    server?: DetectedPreviewUrl;
  }): Promise<void> {
    const ids = Array.from(this.servers.values())
      .filter(
        (server) =>
          server.projectId === input.projectId &&
          server.workspaceId === input.workspaceId &&
          server.source.kind === 'terminal-output' &&
          server.source.terminalId === input.terminalId &&
          matchesDetectedServer(server, input.server)
      )
      .map((server) => server.id);
    await Promise.all(ids.map((id) => this.stop(id)));
  }

  private addServer(identity: string, server: PreviewServer, metadata: PreviewMetadata): void {
    this.identities.set(identity, server.id);
    this.servers.set(server.id, server);
    this.metadata.set(server.id, metadata);
    this.emit({ type: 'upsert', server });
  }

  private serverForIdentity(identity: string): PreviewServer | undefined {
    const id = this.identities.get(identity);
    return id ? this.servers.get(id) : undefined;
  }
}

function localAutoIdentity(target: {
  projectId: string;
  workspaceId: string;
  host: DirectPreviewServerHost;
  port: number;
}): string {
  return `local:auto:${target.projectId}:${target.workspaceId}:${target.host}:${target.port}`;
}

function sshAutoIdentity(target: {
  projectId: string;
  workspaceId: string;
  connectionId: string;
  port: number;
}): string {
  return `ssh:auto:${target.projectId}:${target.workspaceId}:${target.connectionId}:${target.port}`;
}

function matchesDetectedServer(
  server: PreviewServer,
  detected: DetectedPreviewUrl | undefined
): boolean {
  if (!detected) return true;
  if (server.protocol !== detected.protocol) return false;
  if (server.kind === 'direct') {
    return server.host === detected.host && server.port === detected.port;
  }
  return server.remotePort === detected.port;
}
