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
 * registration. A user's unrelated server that happens to be named "emdash" is
 * left alone rather than silently overwritten with our URL and token.
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
