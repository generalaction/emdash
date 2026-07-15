import { log } from '@main/lib/logger';
import type {
  DirectPreviewServer,
  DirectPreviewServerHost,
  PreviewServer,
  PreviewServerEvent,
  PreviewServerProtocol,
  PreviewServerSource,
} from '@shared/core/preview-servers/types';

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
};

/**
 * Invoked when a locally detected (terminal-sourced) preview server is stopped by
 * the user, so the bridge can send an interrupt signal to the source terminal.
 */
export type StopTerminalServerHandler = (server: DirectPreviewServer) => Promise<void> | void;

export class PreviewServerService {
  private readonly servers = new Map<string, DirectPreviewServer>();
  private readonly identities = new Map<string, string>();
  private readonly metadata = new Map<string, PreviewMetadata>();
  private readonly emit: (event: PreviewServerEvent) => void;
  private stopTerminalServerHandler: StopTerminalServerHandler | undefined;

  constructor({ emit }: { emit: (event: PreviewServerEvent) => void }) {
    this.emit = emit;
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
    this.emit({ type: 'remove', id });
    if (server.source.kind === 'terminal-output') {
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
    if (existing) return existing;

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

  private addServer(
    identity: string,
    server: DirectPreviewServer,
    metadata: PreviewMetadata
  ): void {
    this.identities.set(identity, server.id);
    this.servers.set(server.id, server);
    this.metadata.set(server.id, metadata);
    this.emit({ type: 'upsert', server });
  }

  private serverForIdentity(identity: string): DirectPreviewServer | undefined {
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

function matchesDetectedServer(
  server: DirectPreviewServer,
  detected: DetectedPreviewUrl | undefined
): boolean {
  if (!detected) return true;
  if (server.protocol !== detected.protocol) return false;
  return server.host === detected.host && server.port === detected.port;
}
