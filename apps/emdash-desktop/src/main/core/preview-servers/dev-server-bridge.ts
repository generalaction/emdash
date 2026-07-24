import type { TerminalDevServer, TerminalDevServerList } from '@emdash/core/runtimes/terminals/api';
import { terminalsContract } from '@emdash/core/runtimes/terminals/api';
import { createLiveModelReplica } from '@emdash/wire';
import { nativePathFromHost } from '@core/primitives/desktop-runtime/api';
import type {
  DirectPreviewServer,
  DirectPreviewServerHost,
  PreviewServerProtocol,
  PreviewServerSource,
} from '@core/primitives/preview-servers/api';
import { parsePtySessionId } from '@core/primitives/pty/api';
import type { TerminalsRuntimeClient } from '@main/gateway/desktop-workers';
import { log } from '@main/lib/logger';

export type DevServerBridge = {
  dispose(): Promise<void>;
};

type DetectedPreviewUrl = {
  protocol: PreviewServerProtocol;
  host: DirectPreviewServerHost;
  port: number;
  urlPath: string;
};

export type DevServerBridgeDependencies = {
  previewServers: {
    registerDetectedTarget(target: {
      projectId: string;
      workspaceId: string;
      transport: 'local';
      source: PreviewServerSource;
      protocol: PreviewServerProtocol;
      host: DirectPreviewServerHost;
      port: number;
      urlPath: string;
    }): Promise<DirectPreviewServer>;
    handleTerminalSourceClosed(input: {
      projectId: string;
      workspaceId: string;
      terminalId: string;
      transport: 'local';
      reason: 'local-probe-failed';
      server: DetectedPreviewUrl;
    }): Promise<void>;
    setStopTerminalServerHandler(
      handler: ((server: DirectPreviewServer) => Promise<void> | void) | undefined
    ): void;
  };
  resolveWorkspace(
    workspacePath: string,
    host: TerminalDevServer['key']['workspace']['host']
  ): Promise<{ projectId: string; workspaceId: string } | null | undefined>;
};

export async function createDevServerBridge(
  client: TerminalsRuntimeClient,
  dependencies: DevServerBridgeDependencies
): Promise<DevServerBridge> {
  let previous = new Map<string, TerminalDevServer>();
  const replica = createLiveModelReplica(terminalsContract.devServers, client.devServers, {
    onChange: {
      list: (list: TerminalDevServerList) => {
        void syncDevServers(dependencies, previous, list).catch((error) => {
          log.warn('dev-server-bridge: failed to sync detected dev servers', { error });
        });
        previous = new Map(Object.entries(list));
      },
    },
  });
  const lease = replica.acquire(undefined);
  try {
    await lease.ready();
  } catch (error) {
    await Promise.allSettled([lease.release(), replica.dispose()]);
    throw error;
  }

  const stopHandler = async (server: DirectPreviewServer) => {
    const devServer = await findDevServerForPreview(dependencies, previous, server);
    if (!devServer) return;
    const result = await client.sendInput({ key: devServer.key, data: '\x03' });
    if (!result.success) {
      log.warn('dev-server-bridge: failed to interrupt dev server terminal', {
        terminalId: devServer.key.id,
        error: result.error,
      });
    }
  };
  dependencies.previewServers.setStopTerminalServerHandler(stopHandler);

  return {
    async dispose() {
      dependencies.previewServers.setStopTerminalServerHandler(undefined);
      await Promise.all([lease.release(), replica.dispose()]);
      previous = new Map();
    },
  };
}

async function syncDevServers(
  dependencies: DevServerBridgeDependencies,
  previous: Map<string, TerminalDevServer>,
  nextList: TerminalDevServerList
): Promise<void> {
  const next = new Map(Object.entries(nextList));

  for (const [id, server] of previous) {
    const current = next.get(id);
    if (current && sameDevServer(server, current)) continue;
    await handleDevServerRemoved(dependencies, server);
  }

  for (const [id, server] of next) {
    const old = previous.get(id);
    if (old && sameDevServer(old, server)) continue;
    await handleDevServerAdded(dependencies, server);
  }
}

async function handleDevServerAdded(
  dependencies: DevServerBridgeDependencies,
  server: TerminalDevServer
): Promise<void> {
  const context = await resolveServerContext(dependencies, server);
  if (!context) return;
  await dependencies.previewServers.registerDetectedTarget({
    projectId: context.projectId,
    workspaceId: context.workspaceId,
    transport: 'local',
    source: { kind: 'terminal-output', terminalId: context.terminalId },
    protocol: server.protocol,
    host: server.host,
    port: server.port,
    urlPath: server.urlPath,
  });
}

async function handleDevServerRemoved(
  dependencies: DevServerBridgeDependencies,
  server: TerminalDevServer
): Promise<void> {
  const context = await resolveServerContext(dependencies, server);
  if (!context) return;
  await dependencies.previewServers.handleTerminalSourceClosed({
    projectId: context.projectId,
    workspaceId: context.workspaceId,
    terminalId: context.terminalId,
    transport: 'local',
    reason: 'local-probe-failed',
    server: detectedPreviewUrl(server),
  });
}

async function resolveServerContext(
  dependencies: DevServerBridgeDependencies,
  server: TerminalDevServer
): Promise<
  | {
      projectId: string;
      workspaceId: string;
      terminalId: string;
    }
  | undefined
> {
  const workspacePath = nativePathFromHost(server.key.workspace.path);
  const workspace = await dependencies.resolveWorkspace(workspacePath, server.key.workspace.host);
  if (!workspace) return undefined;
  const parsed = parsePtySessionId(server.key.id);
  return {
    projectId: workspace.projectId,
    workspaceId: workspace.workspaceId,
    terminalId: parsed?.leafId ?? server.key.id,
  };
}

function detectedPreviewUrl(server: TerminalDevServer): DetectedPreviewUrl {
  return {
    protocol: server.protocol,
    host: server.host,
    port: server.port,
    urlPath: server.urlPath,
  };
}

async function findDevServerForPreview(
  dependencies: DevServerBridgeDependencies,
  devServers: Map<string, TerminalDevServer>,
  preview: DirectPreviewServer
): Promise<TerminalDevServer | undefined> {
  if (preview.source.kind !== 'terminal-output') return undefined;
  for (const devServer of devServers.values()) {
    if (devServer.protocol !== preview.protocol) continue;
    if (devServer.host !== preview.host) continue;
    if (devServer.port !== preview.port) continue;
    const context = await resolveServerContext(dependencies, devServer);
    if (!context) continue;
    if (context.projectId !== preview.projectId) continue;
    if (context.workspaceId !== preview.workspaceId) continue;
    if (context.terminalId !== preview.source.terminalId) continue;
    return devServer;
  }
  return undefined;
}

function sameDevServer(a: TerminalDevServer, b: TerminalDevServer): boolean {
  return (
    a.protocol === b.protocol &&
    a.host === b.host &&
    a.port === b.port &&
    a.urlPath === b.urlPath &&
    a.key.id === b.key.id
  );
}
