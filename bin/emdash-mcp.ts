/**
 * `emdash-mcp` — standalone Node entrypoint that bridges stdio (used by
 * external MCP clients like Claude Code, Cursor, Codex) to the loopback HTTP
 * MCP server hosted inside the Electron main process.
 *
 * Architecture (see
 * `docs/superpowers/specs/2026-05-16-mcp-server-design.md`):
 *
 *   Claude Code  ──stdio──▶  emdash-mcp (this process)  ──HTTP──▶  emdash app
 *
 * The bridge is a man-in-the-middle proxy:
 *   - It ACTS AS A SERVER toward the external client over stdio
 *     (`StdioServerTransport`).
 *   - It ACTS AS A CLIENT toward the running emdash app over HTTP
 *     (`StreamableHTTPClientTransport`).
 *
 * The SDK does not ship a built-in bridge: we implement the forwarding here
 * with passthrough request handlers and a fallback notification handler that
 * republishes server-initiated notifications onto the stdio side.
 *
 * Loopback-only: the HTTP side connects ONLY to `127.0.0.1:<port>`, never any
 * other host, even if a malformed token file tries to redirect us.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  CallToolResultSchema,
  CompleteRequestSchema,
  CompleteResultSchema,
  EmptyResultSchema,
  GetPromptRequestSchema,
  GetPromptResultSchema,
  ListPromptsRequestSchema,
  ListPromptsResultSchema,
  ListResourcesRequestSchema,
  ListResourcesResultSchema,
  ListResourceTemplatesRequestSchema,
  ListResourceTemplatesResultSchema,
  ListToolsRequestSchema,
  ListToolsResultSchema,
  ReadResourceRequestSchema,
  ReadResourceResultSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
  type Notification,
  type ServerCapabilities,
} from '@modelcontextprotocol/sdk/types.js';
import { readTokenFile } from '../src/main/core/mcp-server/token-store';

const LOOPBACK_HOST = '127.0.0.1';
const MCP_ENDPOINT = '/mcp';

const SERVER_NAME = 'emdash-mcp-bridge';
const SERVER_VERSION = '1';

const MAX_RECONNECT_ATTEMPTS = 3;
const INITIAL_BACKOFF_MS = 250;

/** Resolved bridge configuration. */
export interface BridgeConfig {
  port: number;
  token: string;
}

/**
 * Resolve the port + token the bridge will use.
 *
 * Token always comes from `~/.emdash/mcp.json`. Port honors
 * `EMDASH_MCP_PORT` (the snippet `mcpServerController.getConfigSnippets`
 * emits) and falls back to whatever is recorded in the token file.
 *
 * Exported for unit tests.
 */
export async function resolveBridgeConfig(env: NodeJS.ProcessEnv = process.env): Promise<
  | {
      ok: true;
      config: BridgeConfig;
    }
  | { ok: false; reason: string }
> {
  const file = await readTokenFile();
  if (!file) {
    return {
      ok: false,
      reason:
        'No MCP token file found at ~/.emdash/mcp.json. Open emdash, go to Settings → MCP Server, enable the server, and try again.',
    };
  }
  const overridePort = parsePortEnv(env.EMDASH_MCP_PORT);
  const port = overridePort ?? file.port;
  if (!isValidPort(port)) {
    return {
      ok: false,
      reason: `Invalid MCP port (${port}). Expected an integer between 1 and 65535.`,
    };
  }
  return {
    ok: true,
    config: { port, token: file.token },
  };
}

function parsePortEnv(raw: string | undefined): number | null {
  if (raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n)) return null;
  return n;
}

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port < 65536;
}

/**
 * Build the MCP HTTP URL. Always loopback — never read host from anywhere
 * external. The token file format only carries a port; if a future revision
 * tried to add a host field, this function would still ignore it.
 */
export function buildMcpUrl(port: number): URL {
  return new URL(`http://${LOOPBACK_HOST}:${port}${MCP_ENDPOINT}`);
}

/**
 * Construct the SDK `Client` and the underlying HTTP transport for a single
 * connection attempt. The auth token is injected via `requestInit.headers`
 * (the simplest form supported by `StreamableHTTPClientTransport`).
 *
 * Exported for unit tests.
 */
export function createHttpClient(config: BridgeConfig): {
  client: Client;
  transport: StreamableHTTPClientTransport;
} {
  const transport = new StreamableHTTPClientTransport(buildMcpUrl(config.port), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${config.token}`,
      },
    },
  });
  const client = new Client(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      // No client-side capabilities advertised — the bridge does not satisfy
      // sampling/elicitation/roots itself; if the upstream server requests
      // them they will simply fail (the external client could implement them
      // in a future revision and we would forward them, but that's out of
      // scope for v1 per the spec).
      capabilities: {},
    }
  );
  return { client, transport };
}

/**
 * Build the SDK `Server` over stdio that fronts the external MCP client.
 *
 * We declare a permissive capability set: `tools`, `resources` (with
 * `subscribe: true`), `prompts`, `completions`, `logging`. This is necessary
 * because the SDK's `setRequestHandler` and `notification()` methods assert
 * the capability before letting them through; the bridge has to be ready to
 * forward whatever the upstream emdash server supports today and tomorrow.
 *
 * If the external client invokes a capability the upstream server does not
 * actually implement (e.g. `prompts/list` against a tools-only build), the
 * forwarded `client.request` will throw at the upstream `Client`'s capability
 * assertion and that error is returned to the caller as a JSON-RPC error —
 * which is the appropriate behaviour.
 *
 * Exported for unit tests.
 */
export function createStdioServer(): Server {
  const capabilities: ServerCapabilities = {
    tools: { listChanged: true },
    resources: { subscribe: true, listChanged: true },
    prompts: { listChanged: true },
    completions: {},
    logging: {},
  };
  return new Server({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities });
}

/**
 * Wire passthrough request handlers from the stdio server through to the HTTP
 * client. Each handler simply forwards `request.params` and returns the
 * response unchanged — the SDK takes care of the JSON-RPC envelope on each
 * side.
 *
 * Exported for unit tests so we can verify the handler set without spawning
 * a subprocess.
 */
export function installPassthroughHandlers(server: Server, client: Client): void {
  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    return client.request({ method: 'tools/list', params: request.params }, ListToolsResultSchema);
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return client.request({ method: 'tools/call', params: request.params }, CallToolResultSchema);
  });
  server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
    return client.request(
      { method: 'resources/list', params: request.params },
      ListResourcesResultSchema
    );
  });
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async (request) => {
    return client.request(
      { method: 'resources/templates/list', params: request.params },
      ListResourceTemplatesResultSchema
    );
  });
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    return client.request(
      { method: 'resources/read', params: request.params },
      ReadResourceResultSchema
    );
  });
  server.setRequestHandler(SubscribeRequestSchema, async (request) => {
    return client.request(
      { method: 'resources/subscribe', params: request.params },
      EmptyResultSchema
    );
  });
  server.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
    return client.request(
      { method: 'resources/unsubscribe', params: request.params },
      EmptyResultSchema
    );
  });
  server.setRequestHandler(ListPromptsRequestSchema, async (request) => {
    return client.request(
      { method: 'prompts/list', params: request.params },
      ListPromptsResultSchema
    );
  });
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    return client.request({ method: 'prompts/get', params: request.params }, GetPromptResultSchema);
  });
  server.setRequestHandler(CompleteRequestSchema, async (request) => {
    return client.request(
      { method: 'completion/complete', params: request.params },
      CompleteResultSchema
    );
  });
}

/**
 * Forward server-initiated notifications from the upstream HTTP client onto
 * the stdio side. We use a single fallback handler so we don't have to
 * enumerate every notification method the upstream might emit (per spec the
 * bridge is method-agnostic for forwarding).
 *
 * Exported for unit tests.
 */
export function installNotificationForwarder(server: Server, client: Client): void {
  client.fallbackNotificationHandler = async (notification: Notification) => {
    try {
      // The SDK's `notification` type is structurally compatible with
      // `ServerNotification`, but the broad union forces a cast. We don't
      // mutate the payload — just pass it through verbatim.
      await server.notification(notification as Parameters<typeof server.notification>[0]);
    } catch (err) {
      // Don't crash the bridge if the stdio side rejects a notification (e.g.
      // because the SDK's capability assertion blocks an unknown method).
      // Log to stderr so it shows up in the host MCP client's logs without
      // contaminating the JSON-RPC stdout channel.
      process.stderr.write(
        `[emdash-mcp] failed to forward notification ${notification.method}: ${(err as Error).message}\n`
      );
    }
  };
}

/**
 * Connect the HTTP client to the upstream emdash MCP server with bounded
 * retries.
 *
 * Returns the connected `Client` + transport on success. On the final
 * failure, throws the underlying error.
 *
 * Exported for unit tests.
 */
export async function connectHttpWithRetry(
  config: BridgeConfig,
  options: {
    maxAttempts?: number;
    initialBackoffMs?: number;
    onAttempt?: (attempt: number, err: Error | null) => void;
  } = {}
): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  const maxAttempts = options.maxAttempts ?? MAX_RECONNECT_ATTEMPTS;
  const initialBackoff = options.initialBackoffMs ?? INITIAL_BACKOFF_MS;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { client, transport } = createHttpClient(config);
    try {
      await client.connect(transport);
      options.onAttempt?.(attempt, null);
      return { client, transport };
    } catch (err) {
      lastErr = err;
      options.onAttempt?.(attempt, err as Error);
      // Best-effort cleanup of the half-open transport before retrying.
      try {
        await transport.close();
      } catch {
        // ignore
      }
      if (attempt < maxAttempts) {
        const delay = initialBackoff * 2 ** (attempt - 1);
        await sleep(delay);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Diagnostic message printed to stderr on startup failure. Centralised so the
 * tone is consistent across all "emdash isn't reachable" paths.
 */
function diagnostic(reason: string): string {
  return [
    `emdash-mcp: ${reason}`,
    '',
    'Make sure the emdash app is running and that the MCP server is enabled',
    'in Settings → MCP Server.',
    '',
  ].join('\n');
}

/**
 * Main entrypoint. Boots the bridge end-to-end:
 *  1. Resolve port + token.
 *  2. Connect the HTTP client (with bounded retries).
 *  3. Open the stdio server, install handlers + notification forwarder.
 *  4. Wait for either side to close, then exit cleanly.
 */
export async function runBridge(): Promise<void> {
  const resolved = await resolveBridgeConfig();
  if (!resolved.ok) {
    process.stderr.write(diagnostic(resolved.reason));
    process.exit(1);
  }

  let httpClient: Client;
  let httpTransport: StreamableHTTPClientTransport;
  try {
    ({ client: httpClient, transport: httpTransport } = await connectHttpWithRetry(
      resolved.config
    ));
  } catch (err) {
    process.stderr.write(
      diagnostic(
        `failed to connect to emdash MCP server at ${LOOPBACK_HOST}:${resolved.config.port}${MCP_ENDPOINT}: ${(err as Error).message}`
      )
    );
    process.exit(1);
  }

  const stdioServer = createStdioServer();
  const stdioTransport = new StdioServerTransport();

  installPassthroughHandlers(stdioServer, httpClient);
  installNotificationForwarder(stdioServer, httpClient);

  // Bridge shutdown signalling. `done` resolves when either side closes
  // (client disconnect, upstream HTTP drop, SIGINT, SIGTERM, etc.).
  let resolveDone!: () => void;
  const done = new Promise<void>((r) => {
    resolveDone = r;
  });

  const cleanup = async (): Promise<void> => {
    try {
      await stdioServer.close();
    } catch {
      // ignore
    }
    try {
      await httpClient.close();
    } catch {
      // ignore
    }
    try {
      await httpTransport.close();
    } catch {
      // ignore
    }
    resolveDone();
  };

  // If the stdio side closes (parent MCP client exited), shut down.
  stdioServer.onclose = () => {
    void cleanup();
  };
  // If the HTTP side drops, shut down — clients will respawn the bridge.
  httpClient.onclose = () => {
    void cleanup();
  };

  // Graceful shutdown signals.
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const sig of signals) {
    process.once(sig, () => {
      void cleanup();
    });
  }

  try {
    await stdioServer.connect(stdioTransport);
  } catch (err) {
    process.stderr.write(diagnostic(`failed to attach stdio transport: ${(err as Error).message}`));
    await cleanup();
    process.exit(1);
  }

  await done;
}

// Only auto-run when this file is the entrypoint. The unit tests import the
// helpers above without triggering `runBridge()`.
const isEntrypoint = (() => {
  try {
    const argv1 = process.argv[1];
    if (!argv1) return false;
    const here = new URL(import.meta.url).pathname;
    return argv1 === here || argv1.endsWith('/emdash-mcp.js') || argv1.endsWith('/emdash-mcp.ts');
  } catch {
    return false;
  }
})();

if (isEntrypoint) {
  runBridge().catch((err) => {
    process.stderr.write(diagnostic(`unexpected error: ${(err as Error).message}\n`));
    process.exit(1);
  });
}
