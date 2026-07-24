import { randomUUID } from 'node:crypto';
import { hostRef } from '@emdash/core/primitives/host/api';
import { runtimeHostUnavailable } from '@emdash/core/primitives/runtime-resolution/api';
import { err, ok, type Result } from '@emdash/shared';
import { log } from '@emdash/shared/logger';
import type {
  DirectPreviewServer,
  DirectPreviewServerHost,
  ManualPreviewServerError,
  ManualPreviewServerRequest,
  ManualPreviewServerResult,
  PreviewServer,
  PreviewServerEvent,
  PreviewServerProtocol,
  PreviewServerSource,
} from '@core/primitives/preview-servers/api';
import type { ConnectionState } from '@core/primitives/ssh/api';
import type { SshClientProxy } from '@core/services/ssh/node/lifecycle/ssh-client-proxy';
import type { SshConnectionManagerEvent } from '@core/services/ssh/node/lifecycle/ssh-connection-manager';
import { PortForwardService, type PortForwardRecord } from './port-forward-service';

export type DetectedPreviewUrl = {
  protocol: PreviewServerProtocol;
  host: DirectPreviewServerHost;
  port: number;
  urlPath: string;
};

type PreviewSourceClosed =
  | { reason: 'pty-exit' }
  | { reason: 'local-probe-failed'; server: DetectedPreviewUrl };

export type RegisterDetectedPreviewTarget = {
  projectId: string;
  workspaceId: string;
  transport: 'local';
  source: PreviewServerSource;
  protocol: PreviewServerProtocol;
  host: DirectPreviewServerHost;
  port: number;
  urlPath: string;
};

export type TerminalSourceClosedInput = {
  projectId: string;
  workspaceId: string;
  terminalId: string;
  transport: 'local';
  reason: PreviewSourceClosed['reason'];
  server?: DetectedPreviewUrl;
};

type PreviewMetadata = {
  identity: string;
  tunnelId?: string;
};

type PreviewSshRuntime = {
  getConnectionState: (connectionId: string) => ConnectionState;
  getSshProxy: (connectionId: string) => Promise<Pick<SshClientProxy, 'client' | 'isConnected'>>;
};

/**
 * Invoked when a locally detected (terminal-sourced) preview server is stopped by
 * the user, so the bridge can send an interrupt signal to the source terminal.
 */
export type StopTerminalServerHandler = (server: DirectPreviewServer) => Promise<void> | void;

export class PreviewServerService {
  private readonly servers = new Map<string, PreviewServer>();
  private readonly identities = new Map<string, string>();
  private readonly metadata = new Map<string, PreviewMetadata>();
  private readonly portForwards: PortForwardService;
  private readonly emit: (event: PreviewServerEvent) => void;
  private sshRuntime: PreviewSshRuntime | undefined;
  private stopTerminalServerHandler: StopTerminalServerHandler | undefined;

  constructor({
    emit,
    portForwards = new PortForwardService(),
  }: {
    emit: (event: PreviewServerEvent) => void;
    portForwards?: PortForwardService;
  }) {
    this.emit = emit;
    this.portForwards = portForwards;
    this.portForwards.onConnectionError((tunnelId, error) => {
      void this.handlePortForwardConnectionError(tunnelId, error).catch((handlerError) => {
        log.warn('PreviewServerService: failed to handle SSH preview tunnel connection error', {
          tunnelId,
          error: String(handlerError),
        });
      });
    });
  }

  attachSshRuntime(runtime: PreviewSshRuntime): void {
    this.sshRuntime = runtime;
  }

  async registerDetectedTarget(
    target: RegisterDetectedPreviewTarget
  ): Promise<DirectPreviewServer> {
    return this.registerLocalTarget(target);
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

  async forwardManual(request: ManualPreviewServerRequest): Promise<ManualPreviewServerResult> {
    const id = `manual:${randomUUID()}`;
    const tunnelId = `preview:${id}`;
    const server: PreviewServer = {
      id,
      kind: 'forwarded',
      projectId: request.projectId,
      workspaceId: request.workspaceId,
      source: { kind: 'manual' },
      protocol: request.protocol,
      urlPath: '/',
      status: { kind: 'starting' },
      connectionId: request.connectionId,
      remotePort: request.remotePort,
    };
    this.addServer(id, server, { identity: id, tunnelId });

    const proxyResult = await this.resolveManualSshProxy(request.connectionId);
    if (!proxyResult.success) {
      if (!this.servers.has(id)) return err(manualForwardCancelledError());
      await this.removeFailedManualForward(id);
      return err(proxyResult.error);
    }
    const currentBeforeOpen = this.servers.get(id);
    if (!currentBeforeOpen || currentBeforeOpen.kind !== 'forwarded') {
      return err(manualForwardCancelledError());
    }

    const forwardResult = await this.openManualTunnel({
      id: tunnelId,
      projectId: request.projectId,
      workspaceId: request.workspaceId,
      connectionId: request.connectionId,
      proxy: proxyResult.data,
      remotePort: request.remotePort,
      preferredLocalPort: request.preferredLocalPort ?? request.remotePort,
    });
    if (!forwardResult.success) {
      if (!this.servers.has(id)) return err(manualForwardCancelledError());
      await this.removeFailedManualForward(id);
      return err(forwardResult.error);
    }

    const current = this.servers.get(id);
    if (!current || current.kind !== 'forwarded') {
      await this.portForwards.stop(tunnelId);
      return err(manualForwardCancelledError());
    }

    const next: PreviewServer = {
      ...current,
      localPort: forwardResult.data.localPort,
      status: { kind: 'ready' },
    };
    this.servers.set(next.id, next);
    this.emit({ type: 'upsert', server: next });
    return ok(next);
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
      if (server.localPort === undefined && server.status.kind === 'failed') continue;
      if (event.type === 'reconnected' && server.localPort === undefined) continue;

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

  async handleTerminalSourceClosed(input: TerminalSourceClosedInput): Promise<void> {
    await this.stopForTerminal(input);
  }

  setStopTerminalServerHandler(handler: StopTerminalServerHandler | undefined): void {
    this.stopTerminalServerHandler = handler;
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
    if (server.kind === 'direct' && server.source.kind === 'terminal-output') {
      try {
        await this.stopTerminalServerHandler?.(server);
      } catch (error) {
        log.warn('PreviewServerService: failed to interrupt dev server terminal', {
          serverId: id,
          error: String(error),
        });
      }
    }
  }

  async restart(id: string): Promise<PreviewServer | undefined> {
    const server = this.servers.get(id);
    const metadata = this.metadata.get(id);
    if (!server || server.kind !== 'forwarded' || !metadata?.tunnelId) return server;

    const starting: PreviewServer = {
      ...server,
      status: { kind: 'starting' },
    };
    this.servers.set(id, starting);
    this.emit({ type: 'upsert', server: starting });

    try {
      await this.portForwards.stop(metadata.tunnelId);
      const proxy = await this.getSshProxy(server.connectionId);
      const forward = await this.portForwards.open({
        id: metadata.tunnelId,
        projectId: server.projectId,
        workspaceId: server.workspaceId,
        connectionId: server.connectionId,
        proxy,
        remotePort: server.remotePort,
        preferredLocalPort: server.localPort ?? server.remotePort,
      });
      const current = this.servers.get(id);
      if (!current || current.kind !== 'forwarded') {
        await this.portForwards.stop(metadata.tunnelId);
        return starting;
      }
      const next: PreviewServer = {
        ...current,
        localPort: forward.localPort,
        status: { kind: 'ready' },
      };
      this.servers.set(id, next);
      this.emit({ type: 'upsert', server: next });
      return next;
    } catch (error) {
      log.warn('PreviewServerService: failed to restart SSH preview tunnel', {
        projectId: server.projectId,
        workspaceId: server.workspaceId,
        connectionId: server.connectionId,
        remotePort: server.remotePort,
        error: String(error),
      });
      const current = this.servers.get(id);
      if (!current || current.kind !== 'forwarded') return starting;
      const next: PreviewServer = {
        ...current,
        status: { kind: 'failed', message: 'Failed to open SSH port forward' },
      };
      this.servers.set(id, next);
      this.emit({ type: 'upsert', server: next });
      return next;
    }
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

  private registerLocalTarget(target: RegisterDetectedPreviewTarget): DirectPreviewServer {
    const identity = localAutoIdentity(target);
    const existing = this.serverForIdentity(identity);
    if (existing?.kind === 'direct') return existing;

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

  private async handlePortForwardConnectionError(tunnelId: string, error: Error): Promise<void> {
    const server = this.serverForTunnel(tunnelId);
    if (!server || server.kind !== 'forwarded') return;
    if (server.status.kind === 'failed' && server.localPort === undefined) return;

    log.warn('PreviewServerService: SSH preview tunnel connection failed', {
      projectId: server.projectId,
      workspaceId: server.workspaceId,
      connectionId: server.connectionId,
      remotePort: server.remotePort,
      error: String(error),
    });

    await this.portForwards.stop(tunnelId);
    const current = this.servers.get(server.id);
    if (!current || current.kind !== 'forwarded') return;

    const next: PreviewServer = {
      ...current,
      localPort: undefined,
      status: { kind: 'failed', message: 'Remote preview port is no longer accepting connections' },
    };
    this.servers.set(next.id, next);
    this.emit({ type: 'upsert', server: next });
  }

  private async getSshProxy(
    connectionId: string
  ): Promise<Pick<SshClientProxy, 'client' | 'isConnected'>> {
    if (!this.sshRuntime) {
      throw new Error('SSH runtime is not attached');
    }
    return await this.sshRuntime.getSshProxy(connectionId);
  }

  private async resolveManualSshProxy(
    connectionId: string
  ): Promise<Result<Pick<SshClientProxy, 'client' | 'isConnected'>, ManualPreviewServerError>> {
    if (!this.sshRuntime) {
      return err(
        runtimeHostUnavailable(
          hostRef('remote', connectionId),
          'Port forwarding is not available before the SSH runtime is initialized.'
        )
      );
    }

    try {
      return ok(await this.sshRuntime.getSshProxy(connectionId));
    } catch (error) {
      log.warn('PreviewServerService: failed to resolve SSH proxy for manual preview tunnel', {
        connectionId,
        error: String(error),
      });
      return err(manualForwardOpenFailedError());
    }
  }

  private async openManualTunnel(request: {
    id: string;
    projectId: string;
    workspaceId: string;
    connectionId: string;
    proxy: Pick<SshClientProxy, 'client' | 'isConnected'>;
    remotePort: number;
    preferredLocalPort: number;
  }): Promise<Result<PortForwardRecord, ManualPreviewServerError>> {
    try {
      return ok(await this.portForwards.open(request));
    } catch (error) {
      log.warn('PreviewServerService: failed to open manual SSH preview tunnel', {
        projectId: request.projectId,
        workspaceId: request.workspaceId,
        connectionId: request.connectionId,
        remotePort: request.remotePort,
        error: String(error),
      });
      return err(manualForwardOpenFailedError());
    }
  }

  private async removeFailedManualForward(id: string): Promise<void> {
    if (this.servers.has(id)) {
      await this.stop(id);
    }
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

  private serverForTunnel(tunnelId: string): PreviewServer | undefined {
    for (const [serverId, metadata] of this.metadata.entries()) {
      if (metadata.tunnelId === tunnelId) return this.servers.get(serverId);
    }
    return undefined;
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

function manualForwardCancelledError(): ManualPreviewServerError {
  return {
    type: 'cancelled',
    message: 'Manual preview forwarding was cancelled',
  };
}

function manualForwardOpenFailedError(): ManualPreviewServerError {
  return {
    type: 'open-failed',
    message: 'Failed to open SSH port forward',
  };
}
