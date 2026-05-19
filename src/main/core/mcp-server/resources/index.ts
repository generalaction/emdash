/**
 * Aggregates registration of every MCP resource onto the SDK `McpServer`.
 *
 * Construction order matters: `task-session-resource` wires the shared
 * `resources/subscribe` / `resources/unsubscribe` handlers and the
 * transport-close cleanup. The project/task resources only register read
 * callbacks; their subscriptions are deferred to v2 and rely on the shared
 * handler accepting non-PTY URIs without installing a listener.
 *
 * A single `PtyMcpAdapter` is shared with the task-session resource. The
 * adapter — and the underlying `ptySessionRegistry` import it depends on —
 * are resolved lazily on the first read/subscribe call so that simply
 * constructing an `McpServer` (e.g. in `http-server.test.ts`) does not pull
 * in `@main/lib/events` → `electron` / `@main/db/...` at module load time.
 * This mirrors the deferred-import pattern in `tools/task-tools.ts`.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerProjectResource } from './project-resource';
import { PtyMcpAdapter } from './pty-mcp-adapter';
import { registerTaskResource } from './task-resource';
import { registerTaskSessionResource } from './task-session-resource';

let cachedAdapter: PtyMcpAdapter | null = null;
let cachedAdapterPromise: Promise<PtyMcpAdapter> | null = null;

async function loadAdapter(): Promise<PtyMcpAdapter> {
  if (cachedAdapter) return cachedAdapter;
  if (cachedAdapterPromise) return cachedAdapterPromise;
  cachedAdapterPromise = (async () => {
    const mod = await import('@main/core/pty/pty-session-registry');
    cachedAdapter = new PtyMcpAdapter(mod.ptySessionRegistry);
    return cachedAdapter;
  })();
  return cachedAdapterPromise;
}

/** @internal — for tests: inject a ready-made adapter. */
export function _setResourceAdapter(adapter: PtyMcpAdapter): void {
  cachedAdapter = adapter;
  cachedAdapterPromise = Promise.resolve(adapter);
}

/** @internal — for tests: clear cached adapter. */
export function _resetResourceAdapter(): void {
  cachedAdapter = null;
  cachedAdapterPromise = null;
}

export function registerAllResources(server: McpServer): void {
  registerTaskSessionResource(server, loadAdapter);
  registerProjectResource(server);
  registerTaskResource(server);
}
