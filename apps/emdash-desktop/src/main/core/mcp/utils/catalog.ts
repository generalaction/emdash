import { catalogData } from '@shared/core/mcp/catalog';
import type { McpCatalogEntry, RawServerEntry } from '@shared/core/mcp/types';

export function loadCatalog(): McpCatalogEntry[] {
  return Object.entries(catalogData).map(([key, entry]) => ({
    key,
    name: entry.name,
    description: entry.description,
    docsUrl: entry.docsUrl,
    defaultConfig: entry.config,
    credentialKeys: entry.credentialKeys,
    managed: entry.managed,
  }));
}

export function getCatalogServerConfig(key: string): RawServerEntry | undefined {
  return catalogData[key]?.config;
}

/** True when the catalog defines this name as a managed (emdash-provided) server. */
export function isManagedCatalogKey(key: string): boolean {
  return catalogData[key]?.managed === true;
}
