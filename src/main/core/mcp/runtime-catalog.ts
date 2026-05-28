import type { RawServerEntry } from '@shared/mcp/types';

const runtimeCatalogConfigs = new Map<string, RawServerEntry>();

export function setRuntimeCatalogConfig(key: string, config: RawServerEntry | null): void {
  if (config) {
    runtimeCatalogConfigs.set(key, config);
  } else {
    runtimeCatalogConfigs.delete(key);
  }
}

export function getRuntimeCatalogConfig(key: string): RawServerEntry | undefined {
  return runtimeCatalogConfigs.get(key);
}
