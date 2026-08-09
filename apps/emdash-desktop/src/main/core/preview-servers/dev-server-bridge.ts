import { scriptsContract } from '@emdash/core/runtimes/scripts/api';
import type { TerminalDevServer, TerminalDevServerList } from '@emdash/core/runtimes/terminals/api';
import { terminalsContract } from '@emdash/core/runtimes/terminals/api';
import { createScope } from '@emdash/shared/concurrency';
import { observe, remote, whenReady } from '@emdash/wire/state';
import {
  hostFileRefFromNativePath,
  nativePathFromHost,
} from '@core/primitives/desktop-runtime/api';
import type {
  DirectPreviewServerHost,
  PreviewServer,
  PreviewServerProtocol,
  PreviewServerSource,
} from '@core/primitives/preview-servers/api';
import { parsePtySessionId } from '@core/primitives/pty/api';
import {
  createLifecycleScriptTerminalId,
  lifecycleScriptNodeIdFromTerminalId,
} from '@core/primitives/terminals/api';
import type { ScriptsRuntimeClient, TerminalsRuntimeClient } from '@main/gateway/desktop-workers';
import { log } from '@main/lib/logger';

export type DevServerBridge = {
  dispose(): Promise<void>;
};

export type DevServerHostContext =
  | { transport: 'local' }
  | { transport: 'ssh'; connectionId: string };

type DetectedPreviewUrl = {
  protocol: PreviewServerProtocol;
  host: DirectPreviewServerHost;
  port: number;
  urlPath: string;
};

export type DevServerBridgeDependencies = {
  previewServers: {
    registerDetectedTarget(
      target: DevServerHostContext & {
        projectId: string;
        workspaceId: string;
        source: PreviewServerSource;
        protocol: PreviewServerProtocol;
        host: DirectPreviewServerHost;
        port: number;
        urlPath: string;
      }
    ): Promise<PreviewServer>;
    handleTerminalSourceClosed(
      input: DevServerHostContext & {
        projectId: string;
        workspaceId: string;
        terminalId: string;
        reason: 'local-probe-failed' | 'source-detached';
        server: DetectedPreviewUrl;
      }
    ): Promise<void>;
    registerStopTerminalServerHandler(
      key: string,
      handler: (server: PreviewServer) => Promise<void> | void
    ): () => void;
  };
  resolveWorkspace(
    workspacePath: string,
    host: TerminalDevServer['key']['workspace']['host']
  ): Promise<{ projectId: string; workspaceId: string } | null | undefined>;
};

export type DevServerBridgeClient = {
  terminals: TerminalsRuntimeClient;
  scripts: ScriptsRuntimeClient;
};

export async function createDevServerBridge(
  client: DevServerBridgeClient,
  dependencies: DevServerBridgeDependencies,
  hostContext: DevServerHostContext
): Promise<DevServerBridge> {
  let previous = new Map<string, TerminalDevServer>();
  let terminalList: TerminalDevServerList = {};
  let scriptList: TerminalDevServerList = {};
  let syncChain = Promise.resolve();
  let disposed = false;
  const scope = createScope({ label: 'dev-server-bridge' });
  const devServers = remote(terminalsContract.devServers, client.terminals.devServers, {
    scope,
    lingerMs: 15_000,
  });
  const member = devServers(undefined);
  const scriptDevServers = remote(scriptsContract.devServers, client.scripts.devServers, {
    scope,
    lingerMs: 15_000,
  });
  const scriptMember = scriptDevServers(undefined);
  const stopHandler = async (server: PreviewServer) => {
    const devServer = await findDevServerForPreview(dependencies, previous, server);
    if (!devServer) return;
    const result = await sendInterrupt(client, devServer);
    if (!result.success) {
      log.warn('dev-server-bridge: failed to interrupt dev server terminal', {
        terminalId: devServer.key.id,
        error: result.error,
      });
    }
  };
  const unregisterStopHandler = dependencies.previewServers.registerStopTerminalServerHandler(
    stopHandlerKey(hostContext),
    stopHandler
  );
  const enqueueSync = () => {
    const list: TerminalDevServerList = { ...terminalList, ...scriptList };
    const next = new Map(Object.entries(list));
    syncChain = syncChain
      .then(async () => {
        try {
          await syncDevServers(dependencies, previous, list, hostContext);
        } finally {
          previous = next;
        }
      })
      .catch((error) => {
        log.warn('dev-server-bridge: failed to sync detected dev servers', { error });
      });
  };

  try {
    observe(
      member.states.list,
      (snapshot) => {
        terminalList = snapshot.value ?? {};
        enqueueSync();
      },
      { scope }
    );
    observe(
      scriptMember.states.list,
      (snapshot) => {
        // Script keys have no host ref; project them onto the terminal shape so the
        // rest of the bridge (workspace resolution, preview sources) stays uniform.
        scriptList = Object.fromEntries(
          Object.entries(snapshot.value ?? {}).map(([id, server]) => [
            `script:${id}`,
            {
              key: {
                workspace: hostFileRefFromNativePath(
                  server.key.workspacePath,
                  hostContext.transport === 'ssh' ? hostContext.connectionId : undefined
                ),
                id: createLifecycleScriptTerminalId(server.key.script),
              },
              protocol: server.protocol,
              host: server.host,
              port: server.port,
              urlPath: server.urlPath,
              detectedAt: server.detectedAt,
            } satisfies TerminalDevServer,
          ])
        );
        enqueueSync();
      },
      { scope }
    );
    await whenReady(member.states.list, { scope });
    await whenReady(scriptMember.states.list, { scope });
    await syncChain;
  } catch (error) {
    unregisterStopHandler();
    await scope.dispose(error);
    throw error;
  }

  return {
    async dispose() {
      if (disposed) return;
      disposed = true;
      await scope.dispose();
      await syncChain;
      try {
        await syncDevServers(dependencies, previous, {}, hostContext, 'source-detached');
      } finally {
        previous = new Map();
        unregisterStopHandler();
      }
    },
  };
}

async function syncDevServers(
  dependencies: DevServerBridgeDependencies,
  previous: Map<string, TerminalDevServer>,
  nextList: TerminalDevServerList,
  hostContext: DevServerHostContext,
  removalReason: 'local-probe-failed' | 'source-detached' = 'local-probe-failed'
): Promise<void> {
  const next = new Map(Object.entries(nextList));

  for (const [id, server] of previous) {
    const current = next.get(id);
    if (current && sameDevServer(server, current)) continue;
    await handleDevServerRemoved(dependencies, server, hostContext, removalReason);
  }

  for (const [id, server] of next) {
    const old = previous.get(id);
    if (old && sameDevServer(old, server)) continue;
    await handleDevServerAdded(dependencies, server, hostContext);
  }
}

async function handleDevServerAdded(
  dependencies: DevServerBridgeDependencies,
  server: TerminalDevServer,
  hostContext: DevServerHostContext
): Promise<void> {
  const context = await resolveServerContext(dependencies, server);
  if (!context) return;
  await dependencies.previewServers.registerDetectedTarget({
    projectId: context.projectId,
    workspaceId: context.workspaceId,
    ...hostContext,
    source: { kind: 'terminal-output', terminalId: context.terminalId },
    protocol: server.protocol,
    host: server.host,
    port: server.port,
    urlPath: server.urlPath,
  });
}

async function handleDevServerRemoved(
  dependencies: DevServerBridgeDependencies,
  server: TerminalDevServer,
  hostContext: DevServerHostContext,
  reason: 'local-probe-failed' | 'source-detached'
): Promise<void> {
  const context = await resolveServerContext(dependencies, server);
  if (!context) return;
  await dependencies.previewServers.handleTerminalSourceClosed({
    projectId: context.projectId,
    workspaceId: context.workspaceId,
    terminalId: context.terminalId,
    ...hostContext,
    reason,
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
  preview: PreviewServer
): Promise<TerminalDevServer | undefined> {
  if (preview.source.kind !== 'terminal-output') return undefined;
  for (const devServer of devServers.values()) {
    if (devServer.protocol !== preview.protocol) continue;
    if (preview.kind === 'direct' && devServer.host !== preview.host) continue;
    if (devServer.port !== (preview.kind === 'direct' ? preview.port : preview.remotePort))
      continue;
    const context = await resolveServerContext(dependencies, devServer);
    if (!context) continue;
    if (context.projectId !== preview.projectId) continue;
    if (context.workspaceId !== preview.workspaceId) continue;
    if (context.terminalId !== preview.source.terminalId) continue;
    return devServer;
  }
  return undefined;
}

/**
 * Stop through whichever plane owns the PTY: lifecycle-script servers go through
 * the scripts runtime's stop verb (the one cancel control, so the run settles as
 * cancelled in the timeline); interactive terminals get a Ctrl-C.
 */
function sendInterrupt(
  client: DevServerBridgeClient,
  devServer: TerminalDevServer
): Promise<{ success: boolean; error?: unknown }> {
  const script = lifecycleScriptNodeIdFromTerminalId(devServer.key.id);
  if (script === 'prepare' || script === 'setup' || script === 'run' || script === 'teardown') {
    return client.scripts.stop({
      workspacePath: nativePathFromHost(devServer.key.workspace.path),
      script,
    });
  }
  return client.terminals.sendInput({ key: devServer.key, data: '\x03' });
}

function stopHandlerKey(hostContext: DevServerHostContext): string {
  return hostContext.transport === 'local' ? 'local' : hostContext.connectionId;
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
