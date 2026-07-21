import type { McpServer } from '@emdash/core/mcp';
import { log } from '@main/lib/logger';
import { EMDASH_SELF_SERVER_NAME } from '@shared/core/mcp/types';
import { mcpService } from '../services/McpService';
import { mcpHttpServer } from './mcp-http-server';

/**
 * Builds the emdash server entry for the given agents from the live server's
 * connection info. The URL and bearer token always come from here — callers
 * (the saveServer RPC intercept, boot reconciliation) only choose providers.
 * `saveServer` removes the entry from any MCP-capable agent not in the list,
 * so an empty providers list deregisters emdash everywhere.
 */
export function resolveSelfServer(providers: string[]): McpServer {
  const info = mcpHttpServer.getConnectionInfo();
  if (!info) throw new Error('The emdash MCP server is not running');
  return {
    name: EMDASH_SELF_SERVER_NAME,
    transport: 'http',
    url: info.url,
    headers: { Authorization: `Bearer ${info.token}` },
    providers,
  };
}

async function findSelfServer(): Promise<McpServer | undefined> {
  const { installed } = await mcpService.loadAll();
  return installed.find((server) => server.name === EMDASH_SELF_SERVER_NAME);
}

/** True when an installed entry named "emdash" looks like our own loopback registration. */
export function isSelfServerEntry(server: McpServer): boolean {
  if (!server.url) return false;
  try {
    const parsed = new URL(server.url);
    return (
      ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) && parsed.pathname === '/mcp'
    );
  } catch {
    return false;
  }
}

/**
 * Boot-time reconciliation: if the user previously registered emdash in agent
 * configs, rewrite the entry with the current URL and token so token rotation
 * or a port change heals silently. Never creates a registration the user did
 * not opt into.
 */
export async function refreshSelfServerRegistration(): Promise<void> {
  const info = mcpHttpServer.getConnectionInfo();
  if (!info) return;
  const existing = await findSelfServer();
  if (!existing || existing.providers.length === 0) return;
  if (!isSelfServerEntry(existing)) {
    log.warn(
      'McpHttpServer: found an unrelated MCP server named "emdash" in agent configs; leaving it untouched'
    );
    return;
  }

  // Always rewrite: loadAll collapses per-agent entries into one representative,
  // so comparing against it can mask a stale token in another agent's config
  // (e.g. after a partially failed save). saveServer rewrites every agent.
  // Spread the existing entry first so user-set fields (enabled, timeout, cwd)
  // survive the heal; only the connection details are replaced.
  await mcpService.saveServer({ ...existing, ...resolveSelfServer(existing.providers) });
}
