import { catalogData } from '@shared/mcp/catalog';
import type { McpCatalogEntry, RawServerEntry } from '@shared/mcp/types';
import { mcpInternalService } from '@main/core/mcp-internal';
import { EMDASH_MCP_SERVER_NAME } from '@main/core/mcp-internal/catalog-refresh';

function resolveDefaultConfig(key: string, fallback: RawServerEntry): RawServerEntry {
  if (key === EMDASH_MCP_SERVER_NAME) {
    const live = mcpInternalService.getCanonicalRawConfig();
    if (live) return live as unknown as RawServerEntry;
  }
  return fallback;
}

export function loadCatalog(): McpCatalogEntry[] {
  return Object.entries(catalogData).map(([key, entry]) => ({
    key,
    name: entry.name,
    description: entry.description,
    docsUrl: entry.docsUrl,
    defaultConfig: resolveDefaultConfig(key, entry.config),
    credentialKeys: entry.credentialKeys,
  }));
}

export function getCatalogServerConfig(key: string): RawServerEntry | undefined {
  const entry = catalogData[key]?.config;
  if (!entry) return undefined;
  return resolveDefaultConfig(key, entry);
}
