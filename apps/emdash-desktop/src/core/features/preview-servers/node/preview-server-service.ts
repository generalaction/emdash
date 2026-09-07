import { randomUUID } from 'node:crypto';
import { hostRef } from '@emdash/core/primitives/host/api';
import { runtimeHostUnavailable } from '@emdash/core/primitives/runtime-resolution/api';
import { err, ok, type Result } from '@emdash/shared';
import { log } from '@emdash/shared/logger';
import type {
  DirectPreviewServer,
  DirectPreviewServerHost,
  ForwardedPreviewServer,
  ManualPreviewServerError,
  ManualPreviewServerRequest,
  ManualPreviewServerResult,
  PreviewServer,
  PreviewServerEvent,
  PreviewServerProtocol,
  PreviewServerSource,
} from '@core/primitives/preview-servers/api';
import type { ConnectionState } from '@core/primitives/ssh/api';
import type { SshClientProxy } from '@core/primitives/ssh/api/node/ssh-client-proxy';
import type { SshConnectionManagerEvent } from '@core/primitives/ssh/api/node/ssh-connection-manager';
import { PortForwardService, type PortForwardRecord } from './port-forward-service';
import type { PortForwardProbe, PortForwardProbeResult } from './port-forward-tunnel';

export type DetectedPreviewUrl = {
  protocol: PreviewServerProtocol;
  host: DirectPreviewServerHost;
  port: number;
  urlPath: string;
};

export type PreviewTargetTransport =
  | { transport: 'local' }
  | { transport: 'ssh'; connectionId: string };

type PreviewSourceClosed =
  | { reason: 'pty-exit' }
  | { reason: 'local-probe-failed'; server: DetectedPreviewUrl }
  | { reason: 'source-detached' };

export type RegisterDetectedPreviewTarget = PreviewTargetTransport & {
  projectId: string;
  workspaceId: string;
  source: PreviewServerSource;
  protocol: PreviewServerProtocol;
  host: DirectPreviewServerHost;
  port: number;
  urlPath: string;
};

export type TerminalSourceClosedInput = PreviewTargetTransport & {
  projectId: string;
  workspaceId: string;
  terminalId: string;
  reason: PreviewSourceClosed['reason'];
  server?: DetectedPreviewUrl;
};

type PreviewMetadata = {
  identity: string;
  tunnelId?: string;
};

type PreviewSshRuntime = {
  getConnectionState: (connectionId: string) => ConnectionState;
  getSshProxy: (
    connectionId: string
  ) => Promise<Pick<SshClientProxy, 'openTcpChannel' | 'isConnected'>>;
  /**
   * One-shot advisory inspection of a remote port through the host's pinned
   * workspace-server wire client. Absent or rejecting means "no hint": the
   * tunnel keeps its blind dual-family dial.
   */
  inspectRemotePort?: (connectionId: string, remotePort: number) => Promise<PortForwardProbeResult>;
};

/**
 * Invoked when a detected terminal-sourced preview server is stopped by the user,
 * so the bridge for its runtime host can interrupt the source terminal.
 */
export type StopTerminalServerHandler = (server: PreviewServer) => Promise<void> | void;

export class PreviewServerService {
  private readonly servers = new Map<string, PreviewServer>();
  private readonly identities = new Map<string, string>();
  private readonly metadata = new Map<string, PreviewMetadata>();
  private readonly portForwards: PortForwardService;
  private readonly emit: (event: PreviewServerEvent) => void;
  private sshRuntime: PreviewSshRuntime | undefined;
  private readonly stopTerminalServerHandlers = new Map<string, StopTerminalServerHandler>();
  private readonly notListeningTunnels = new Set<string>();

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
    this.portForwards.onProbeResult((tunnelId, result) => {
      this.handlePortForwardProbeResult(tunnelId, result);
    });
    this.portForwards.onConnectionEstablished((tunnelId) => {
      this.handlePortForwardEstablished(tunnelId);
    });
  }

  attachSshRuntime(runtime: PreviewSshRuntime): void {
    this.sshRuntime = runtime;
  }

  async registerDetectedTarget(target: RegisterDetectedPreviewTarget): Promise<PreviewServer> {
    return target.transport === 'local'
      ? this.registerLocalTarget(target)
      : await this.registerForwardedTarget(target);
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

  getServer(id: string): PreviewServer | undefined {
    return this.servers.get(id);
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
      probe: this.probeFor(request.connectionId),
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
      status: this.statusForOpenedTunnel(tunnelId),
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
      if (server.localPort === undefined && server.status.kind === 'failed') {
        const metadata = this.metadata.get(server.id);
        if (event.type === 'reconnected' && metadata?.tunnelId) {
          void this.restart(server.id).catch((error) => {
            log.warn('PreviewServerService: failed to retry SSH preview tunnel after reconnect', {
              serverId: server.id,
              connectionId: server.connectionId,
              error: String(error),
            });
          });
        }
        continue;
      }
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

  registerStopTerminalServerHandler(key: string, handler: StopTerminalServerHandler): () => void {
    this.stopTerminalServerHandlers.set(key, handler);
    return () => {
      if (this.stopTerminalServerHandlers.get(key) === handler) {
        this.stopTerminalServerHandlers.delete(key);
      }
    };
  }

  async stop(id: string): Promise<void> {
    await this.removeServer(id, { interrupt: true });
  }

  private async removeServer(id: string, { interrupt }: { interrupt: boolean }): Promise<void> {
    const server = this.servers.get(id);
    if (!server) return;
    this.servers.delete(id);
    const metadata = this.metadata.get(id);
    this.metadata.delete(id);
    if (metadata) this.identities.delete(metadata.identity);
    if (metadata?.tunnelId) {
      this.notListeningTunnels.delete(metadata.tunnelId);
      await this.portForwards.stop(metadata.tunnelId);
    }
    this.emit({ type: 'remove', id });
    if (interrupt && server.source.kind === 'terminal-output') {
      const handlerKey = server.kind === 'direct' ? 'local' : server.connectionId;
      try {
        await this.stopTerminalServerHandlers.get(handlerKey)?.(server);
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
      this.notListeningTunnels.delete(metadata.tunnelId);
      const proxy = await this.getSshProxy(server.connectionId);
      const forward = await this.portForwards.open({
        id: metadata.tunnelId,
        projectId: server.projectId,
        workspaceId: server.workspaceId,
        connectionId: server.connectionId,
        proxy,
        remotePort: server.remotePort,
        preferredLocalPort: server.localPort ?? server.remotePort,
        probe: this.probeFor(server.connectionId),
      });
      const current = this.servers.get(id);
      if (!current || current.kind !== 'forwarded') {
        await this.portForwards.stop(metadata.tunnelId);
        return starting;
      }
      const next: PreviewServer = {
        ...current,
        localPort: forward.localPort,
        status: this.statusForOpenedTunnel(metadata.tunnelId),
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

  private async registerForwardedTarget(
    target: RegisterDetectedPreviewTarget & { transport: 'ssh' }
  ): Promise<ForwardedPreviewServer> {
    const existingForward = Array.from(this.servers.values()).find(
      (server): server is ForwardedPreviewServer =>
        server.kind === 'forwarded' &&
        server.connectionId === target.connectionId &&
        server.remotePort === target.port &&
        server.projectId === target.projectId &&
        server.workspaceId === target.workspaceId
    );
    if (existingForward) return existingForward;

    const identity = sshAutoIdentity(target);
    const existing = this.serverForIdentity(identity);
    if (existing?.kind === 'forwarded') return existing;

    const tunnelId = `preview:${identity}`;
    const server: ForwardedPreviewServer = {
      id: identity,
      kind: 'forwarded',
      projectId: target.projectId,
      workspaceId: target.workspaceId,
      source: target.source,
      protocol: target.protocol,
      urlPath: target.urlPath,
      status: { kind: 'starting' },
      connectionId: target.connectionId,
      remotePort: target.port,
    };
    this.addServer(identity, server, { identity, tunnelId });

    try {
      const proxy = await this.getSshProxy(target.connectionId);
      const currentBeforeOpen = this.servers.get(server.id);
      if (!currentBeforeOpen || currentBeforeOpen.kind !== 'forwarded') return server;

      const forward = await this.portForwards.open({
        id: tunnelId,
        projectId: target.projectId,
        workspaceId: target.workspaceId,
        connectionId: target.connectionId,
        proxy,
        remotePort: target.port,
        preferredLocalPort: target.port,
        probe: this.probeFor(target.connectionId),
      });
      const current = this.servers.get(server.id);
      if (!current || current.kind !== 'forwarded') {
        await this.portForwards.stop(tunnelId);
        return server;
      }

      const next: ForwardedPreviewServer = {
        ...current,
        localPort: forward.localPort,
        status: this.statusForOpenedTunnel(tunnelId),
      };
      this.servers.set(next.id, next);
      this.emit({ type: 'upsert', server: next });
      return next;
    } catch (error) {
      log.warn('PreviewServerService: failed to open detected SSH preview tunnel', {
        projectId: target.projectId,
        workspaceId: target.workspaceId,
        connectionId: target.connectionId,
        remotePort: target.port,
        error: String(error),
      });
      const current = this.servers.get(server.id);
      if (!current || current.kind !== 'forwarded') return server;
      const next: ForwardedPreviewServer = {
        ...current,
        status: { kind: 'failed', message: 'Failed to open SSH port forward' },
      };
      this.servers.set(next.id, next);
      this.emit({ type: 'upsert', server: next });
      return next;
    }
  }

  private async stopForTerminal(input: TerminalSourceClosedInput): Promise<void> {
    const ids = Array.from(this.servers.values())
      .filter(
        (server) =>
          server.projectId === input.projectId &&
          server.workspaceId === input.workspaceId &&
          matchesTransport(server, input) &&
          server.source.kind === 'terminal-output' &&
          server.source.terminalId === input.terminalId &&
          matchesDetectedServer(server, input.server)
      )
      .map((server) => server.id);
    await Promise.all(ids.map((id) => this.removeServer(id, { interrupt: false })));
  }

  private handlePortForwardProbeResult(tunnelId: string, result: PortForwardProbeResult): void {
    if (result.listening) {
      this.notListeningTunnels.delete(tunnelId);
      return;
    }

    this.notListeningTunnels.add(tunnelId);
    const server = this.serverForTunnel(tunnelId);
    // A tunnel still opening resolves its status through statusForOpenedTunnel.
    if (!server || server.kind !== 'forwarded' || server.status.kind !== 'ready') return;
    const next: PreviewServer = { ...server, status: { kind: 'not-listening' } };
    this.servers.set(next.id, next);
    this.emit({ type: 'upsert', server: next });
  }

  private handlePortForwardEstablished(tunnelId: string): void {
    if (!this.notListeningTunnels.delete(tunnelId)) return;
    const server = this.serverForTunnel(tunnelId);
    if (!server || server.kind !== 'forwarded' || server.status.kind !== 'not-listening') return;
    const next: PreviewServer = { ...server, status: { kind: 'ready' } };
    this.servers.set(next.id, next);
    this.emit({ type: 'upsert', server: next });
  }

  private statusForOpenedTunnel(tunnelId: string): PreviewServer['status'] {
    return this.notListeningTunnels.has(tunnelId) ? { kind: 'not-listening' } : { kind: 'ready' };
  }

  private probeFor(connectionId: string): PortForwardProbe | undefined {
    const inspect = this.sshRuntime?.inspectRemotePort;
    if (!inspect) return undefined;
    return (remotePort) => inspect(connectionId, remotePort);
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

    this.notListeningTunnels.delete(tunnelId);
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
  ): Promise<Pick<SshClientProxy, 'openTcpChannel' | 'isConnected'>> {
    if (!this.sshRuntime) {
      throw new Error('SSH runtime is not attached');
    }
    return await this.sshRuntime.getSshProxy(connectionId);
  }

  private async resolveManualSshProxy(
    connectionId: string
  ): Promise<
    Result<Pick<SshClientProxy, 'openTcpChannel' | 'isConnected'>, ManualPreviewServerError>
  > {
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
    proxy: Pick<SshClientProxy, 'openTcpChannel' | 'isConnected'>;
    remotePort: number;
    preferredLocalPort: number;
    probe?: PortForwardProbe;
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

function sshAutoIdentity(target: {
  connectionId: string;
  projectId: string;
  workspaceId: string;
  protocol: PreviewServerProtocol;
  port: number;
}): string {
  return `ssh:auto:${target.connectionId}:${target.projectId}:${target.workspaceId}:${target.protocol}:${target.port}`;
}

function matchesTransport(server: PreviewServer, transport: PreviewTargetTransport): boolean {
  return transport.transport === 'local'
    ? server.kind === 'direct'
    : server.kind === 'forwarded' && server.connectionId === transport.connectionId;
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
