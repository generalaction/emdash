import type { McpCatalogEntry, McpServer } from '@emdash/core/primitives/mcp/api';

/** Name of the MCP server entry Emdash registers for itself in agent configs. */
export const EMDASH_SELF_SERVER_NAME = 'emdash';

/**
 * `_meta` key marking a catalog entry as managed: a server Emdash itself
 * provides, whose connection details are injected by the node side on save and
 * shown read-only in the UI. Managed-ness travels as catalog data rather than a
 * component-level special case.
 */
export const MCP_MANAGED_META_KEY = 'emdash:managed';

export function isManagedCatalogEntry(entry: Pick<McpCatalogEntry, '_meta'>): boolean {
  return entry._meta?.[MCP_MANAGED_META_KEY] === true;
}

/** Path the local MCP server serves; also the marker for our own registrations. */
export const EMDASH_MCP_PATH = '/mcp';

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/**
 * True when an installed entry named "emdash" looks like our own loopback
 * registration, so a user's unrelated server is not silently overwritten with
 * our URL and token.
 *
 * The port is deliberately not compared: healing a registration whose port
 * changed (EMDASH_MCP_PORT, or the default being taken at startup) is exactly
 * what this predicate is for. The residual collision is a user server named
 * "emdash" on loopback under `/mcp`, which would get its URL and headers
 * rewritten; renaming it opts out.
 */
export function isSelfServerEntry(server: Pick<McpServer, 'url'>): boolean {
  if (!server.url) return false;
  try {
    const parsed = new URL(server.url);
    return LOOPBACK_HOSTNAMES.has(parsed.hostname) && parsed.pathname === EMDASH_MCP_PATH;
  } catch {
    return false;
  }
}
