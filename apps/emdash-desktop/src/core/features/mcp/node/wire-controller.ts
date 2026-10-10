import { isLocalHostRef, type HostRef } from '@emdash/core/primitives/host/api';
import type { McpServer } from '@emdash/core/primitives/mcp/api';
import { err, ok, type Result } from '@emdash/shared';
import type { LiveModelProvider, LiveSource } from '@emdash/wire/rpc';
import { createController, type CallMeta, type Controller } from '@emdash/wire/rpc';
import { EMDASH_SELF_SERVER_NAME, isSelfServerEntry } from '@core/primitives/mcp/api';
import { forwardLiveModel } from '@core/services/runtime-clients/node/forward-live-model';
import { mcpContract } from '../api';
import {
  throwMcpRuntimeResolveError,
  type McpHostRuntimesClient as HostRuntimesClient,
  type McpRuntimeBroker,
  type McpRuntimeResolveError as RuntimeResolveError,
} from '../api/runtime-adapter';

export type CreateMcpWireControllerOptions = Readonly<{
  runtimes: McpRuntimeBroker;
  /**
   * Supplies the connection details for Emdash's own MCP server. The renderer
   * never sees or sends them: it saves the managed entry with only a provider
   * list, and this fills in the local URL and bearer token.
   */
  resolveSelfServer?: (providers: string[]) => Result<McpServer, string>;
}>;

export function createMcpWireController(options: CreateMcpWireControllerOptions): Controller {
  return createController(mcpContract, {
    servers: createServersModelProvider(options.runtimes),
    saveServer: (input, meta) => {
      const server = resolveServerToSave(options, input.host, input.server);
      if (!server.success) return Promise.resolve(server);
      return withAgentConfigResult(options.runtimes, input.host, (client) =>
        client.saveMcpServer({ server: server.data }, callOptions(meta))
      );
    },
    removeServer: (input, meta) =>
      withAgentConfigResult(options.runtimes, input.host, (client) =>
        client.removeMcpServer(withoutHost(input), callOptions(meta))
      ),
    removeForAgent: (input, meta) =>
      withAgentConfigResult(options.runtimes, input.host, (client) =>
        client.removeMcpForAgent(withoutHost(input), callOptions(meta))
      ),
    listForAgent: (input, meta) =>
      withAgentConfigResult(options.runtimes, input.host, (client) =>
        client.listMcpForAgent(withoutHost(input), callOptions(meta))
      ),
  });
}

/**
 * Emdash's own entry is saved by name only; everything else passes through.
 *
 * The match is on shape rather than a renderer-supplied flag: a server named
 * "emdash" counts as ours only when it is an HTTP entry with no URL yet (a fresh
 * save from the catalog) or one already pointing at our loopback endpoint. A
 * user who adds their own server called "emdash" with their own URL keeps it.
 *
 * Local host only: the server binds the desktop's loopback interface, so the
 * entry would be unreachable from a remote workspace server.
 */
function resolveServerToSave(
  options: CreateMcpWireControllerOptions,
  host: HostRef,
  server: McpServer
): Result<McpServer, { type: 'invalid-state'; message: string }> {
  if (server.name !== EMDASH_SELF_SERVER_NAME || !isLocalHostRef(host)) {
    return ok(server);
  }
  if (server.transport !== 'http' || (server.url && !isSelfServerEntry(server))) {
    return ok(server);
  }
  if (!options.resolveSelfServer) {
    return err({ type: 'invalid-state', message: 'The Emdash MCP server is not available' });
  }
  const resolved = options.resolveSelfServer(server.providers);
  if (!resolved.success) return err({ type: 'invalid-state', message: resolved.error });
  // Keep the user's own fields (enabled, timeout, cwd); replace only the
  // connection details the renderer cannot know.
  return ok({ ...server, ...resolved.data });
}

function createServersModelProvider(
  runtimes: McpRuntimeBroker
): LiveModelProvider<typeof mcpContract.servers> {
  return forwardLiveModel(mcpContract.servers, (key, name) =>
    resolveRuntimeSource(runtimes, key.host, (runtime) =>
      runtime.agentConfig.mcpServers.state(undefined, name).asLiveSource()
    )
  );
}

async function withAgentConfigResult<T, E>(
  runtimes: McpRuntimeBroker,
  host: HostRef,
  work: (client: HostRuntimesClient['agentConfig']) => Promise<Result<T, E>>
): Promise<Result<T, E | RuntimeResolveError>> {
  const runtime = await runtimes.client(host);
  if (!runtime.success) return err(runtime.error);
  return await work(runtime.data.agentConfig);
}

async function resolveRuntimeSource(
  runtimes: McpRuntimeBroker,
  host: HostRef,
  source: (client: HostRuntimesClient) => LiveSource
): Promise<LiveSource> {
  const runtime = await runtimes.client(host);
  if (!runtime.success) throwMcpRuntimeResolveError(runtime.error);
  return source(runtime.data);
}

function withoutHost<T extends { host: HostRef }>(input: T): Omit<T, 'host'> {
  const { host: _, ...rest } = input;
  return rest;
}

function callOptions(meta: CallMeta): { signal?: AbortSignal } {
  return meta.signal ? { signal: meta.signal } : {};
}
