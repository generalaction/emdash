import { catalogData } from '@shared/mcp/catalog';
import type { McpCatalogEntry, RawServerEntry } from '@shared/mcp/types';
import { getRuntimeCatalogConfig } from '../runtime-catalog';

export function loadCatalog(): McpCatalogEntry[] {
  return Object.entries(catalogData).map(([key, entry]) => ({
    key,
    name: entry.name,
    description: entry.description,
    docsUrl: entry.docsUrl,
    defaultConfig: getRuntimeCatalogConfig(key) ?? entry.config,
    credentialKeys: entry.credentialKeys,
  }));
}

export function getCatalogServerConfig(key: string): RawServerEntry | undefined {
  return getRuntimeCatalogConfig(key) ?? catalogData[key]?.config;
}
