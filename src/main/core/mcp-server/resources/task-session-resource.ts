/**
 * Registers the `emdash://tasks/{taskId}/sessions/{sessionId}` resource — the
 * PTY session ring buffer + live deltas.
 *
 * - `read` returns a JSON snapshot `{ data, cursor, eof }` built from
 *   `PtyMcpAdapter.snapshot()`. Snapshot does NOT register an IPC consumer
 *   (see the adapter docs for the consumer-leak rationale).
 * - `subscribe` is wired via `setRequestHandler(SubscribeRequestSchema, …)`
 *   on the underlying `Server` instance because the high-level `McpServer`
 *   does not auto-wire `resources/subscribe` / `resources/unsubscribe`.
 *   On `subscribe`, we register a per-URI listener via
 *   `PtyMcpAdapter.subscribeForResource(...)` and send
 *   `notifications/resources/updated` for that URI on every delta. The
 *   unsubscribe is tracked in a per-server `Map<uri, () => void>` and
 *   cleaned up on `unsubscribe` or transport close.
 *
 * URI template: `emdash://tasks/{taskId}/sessions/{sessionId}`.
 */
import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { formatResourceContent } from './_helpers';
import type { PtyMcpAdapter } from './pty-mcp-adapter';

const URI_TEMPLATE = 'emdash://tasks/{taskId}/sessions/{sessionId}';
const MIME_JSON = 'application/json';

/**
 * Per-server subscription bookkeeping. The MCP SDK does not expose a built-in
 * "client unsubscribed" event for the high-level `McpServer`, so we own the
 * Map ourselves and clean up on `resources/unsubscribe` requests + transport
 * close.
 */
type SubscriptionMap = Map<string, () => void>;

const subscriptionsByServer = new WeakMap<McpServer, SubscriptionMap>();
const wiredServers = new WeakSet<McpServer>();

function getSubscriptions(server: McpServer): SubscriptionMap {
  let map = subscriptionsByServer.get(server);
  if (!map) {
    map = new Map();
    subscriptionsByServer.set(server, map);
  }
  return map;
}

function clearAll(server: McpServer): void {
  const map = subscriptionsByServer.get(server);
  if (!map) return;
  for (const off of map.values()) {
    try {
      off();
    } catch {
      // ignore
    }
  }
  map.clear();
}

/**
 * Extracts the `sessionId` segment from an `emdash://tasks/{tid}/sessions/{sid}`
 * URI. Returns null if the URI doesn't match the expected shape.
 */
function sessionIdFromUri(uri: string): string | null {
  const match = /^emdash:\/\/tasks\/[^/]+\/sessions\/([^/]+)\/?$/.exec(uri);
  return match?.[1] ?? null;
}

/**
 * The adapter slot accepts either a ready-made `PtyMcpAdapter` (the test
 * path) or a `() => Promise<PtyMcpAdapter>` factory (the production path
 * from `resources/index.ts`, which defers the `pty-session-registry` import
 * so module load doesn't pull in Electron / the DB).
 */
export type PtyMcpAdapterProvider = PtyMcpAdapter | (() => Promise<PtyMcpAdapter>);

function asAdapterFactory(provider: PtyMcpAdapterProvider): () => Promise<PtyMcpAdapter> {
  if (typeof provider === 'function') return provider;
  const resolved = Promise.resolve(provider);
  return () => resolved;
}

export function registerTaskSessionResource(
  server: McpServer,
  adapterProvider: PtyMcpAdapterProvider
): void {
  const getAdapter = asAdapterFactory(adapterProvider);

  // read handler ─ uses the SDK's templated registerResource overload. The
  // callback is async so we can `await` the lazy adapter factory in
  // production. For tests that pass an adapter directly, the awaited value
  // resolves synchronously on the microtask queue.
  server.registerResource(
    'task-session',
    new ResourceTemplate(URI_TEMPLATE, { list: undefined }),
    {
      title: 'Task PTY session',
      description:
        'Live ring buffer (snapshot + deltas) for a PTY session attached to a task. ' +
        'Read returns { data, cursor, eof }; subscribe streams resource-updated ' +
        'notifications as the PTY produces output.',
      mimeType: MIME_JSON,
    },
    async (uri, variables) => {
      const sessionId = String(variables.sessionId ?? '');
      const adapter = await getAdapter();
      const snapshot = adapter.snapshot(sessionId);
      return formatResourceContent(uri.toString(), MIME_JSON, snapshot);
    }
  );

  // subscribe / unsubscribe handlers ─ on the underlying Server. We wire
  // these once per McpServer instance; later resources for the same server
  // (project, task, etc.) share the same handlers and look up the right
  // listener-factory by URI prefix.
  if (wiredServers.has(server)) return;
  wiredServers.add(server);

  const subs = getSubscriptions(server);
  const underlying = server.server;

  underlying.setRequestHandler(SubscribeRequestSchema, async (request) => {
    const uri = request.params.uri;
    const sessionId = sessionIdFromUri(uri);
    if (sessionId === null) {
      // Other resource types (project, task) don't expose live subscriptions
      // in v1 — silently accept the subscribe so the client doesn't error,
      // but install no listener. Tracked for v2.
      return {};
    }
    // De-dupe: a re-subscribe replaces the prior listener.
    subs.get(uri)?.();
    const adapter = await getAdapter();
    const off = adapter.subscribeForResource(sessionId, () => {
      // Fire-and-forget the resource-updated notification. The SDK serialises
      // it as `notifications/resources/updated` with `{ uri }`.
      void underlying.sendResourceUpdated({ uri });
    });
    subs.set(uri, off);
    return {};
  });

  underlying.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
    const uri = request.params.uri;
    subs.get(uri)?.();
    subs.delete(uri);
    return {};
  });

  // Best-effort cleanup when the transport closes. `onclose` is on the
  // underlying Server / Protocol; assigning to it leaves any existing
  // handlers intact by chaining.
  const prevOnClose = underlying.onclose;
  underlying.onclose = () => {
    clearAll(server);
    prevOnClose?.();
  };

  // Declare the `resources.subscribe` capability so the SDK advertises it
  // in `initialize` responses. `listChanged` is already registered by
  // `registerResource`.
  underlying.registerCapabilities({
    resources: {
      subscribe: true,
    },
  });
}

/** @internal — tests reset per-server subscription bookkeeping. */
export function _resetSubscriptionsFor(server: McpServer): void {
  clearAll(server);
  subscriptionsByServer.delete(server);
}

export { registerTaskSessionResource as register };
