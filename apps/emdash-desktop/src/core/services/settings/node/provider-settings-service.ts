import type { ProviderCustomConfig } from '@core/primitives/app-settings/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { OverrideSettings } from './override-settings';
import {
  migrateProviderConfigOverrides,
  migrateProviderConfigToHostDependencyStore,
  type HostDependencySelectionStore,
} from './provider-config-migrations';
import { providerConfigDefaults, providerCustomConfigEntrySchema } from './provider-config-schema';

export type ProviderOverrideSettings = OverrideSettings<ProviderCustomConfig>;

export function createProviderOverrideSettings(db: AppDb): ProviderOverrideSettings {
  return new OverrideSettings<ProviderCustomConfig>(
    db,
    'providerConfigs',
    () => providerConfigDefaults,
    providerCustomConfigEntrySchema,
    migrateProviderConfigOverrides
  );
}

export async function runProviderSettingsMigration(
  providerOverrideSettings: ProviderOverrideSettings,
  hostDependencyStore: HostDependencySelectionStore
): Promise<void> {
  const raw = await providerOverrideSettings.getRawOverrides();
  await migrateProviderConfigToHostDependencyStore(raw, hostDependencyStore);
  providerOverrideSettings.invalidateCache();
}
