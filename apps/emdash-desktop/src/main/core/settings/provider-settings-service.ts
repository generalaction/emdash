import type { ProviderCustomConfig } from '@shared/core/app-settings';
import { OverrideSettings } from './override-settings';
import {
  migrateProviderConfigOverrides,
  migrateProviderConfigToHostDependencyStore,
} from './provider-config-migrations';
import { providerConfigDefaults, providerCustomConfigEntrySchema } from './schema';

export const providerOverrideSettings = new OverrideSettings<ProviderCustomConfig>(
  'providerConfigs',
  () => providerConfigDefaults as Record<string, ProviderCustomConfig>,
  providerCustomConfigEntrySchema,
  migrateProviderConfigOverrides
);

/**
 * Run at app startup: migrates legacy cli/path/installSource fields from provider
 * config overrides to the host-dependency store, then invalidates the cache so the
 * next read sees the stripped config.
 */
export async function runProviderSettingsMigration(): Promise<void> {
  const { hostDependencyStore } = await import('../dependencies/host-dependency-store');
  const raw = await providerOverrideSettings.getRawOverrides();
  await migrateProviderConfigToHostDependencyStore(raw, hostDependencyStore);
  providerOverrideSettings.invalidateCache();
}
