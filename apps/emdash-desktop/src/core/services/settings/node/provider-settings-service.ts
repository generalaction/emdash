import type { ProviderCustomConfig } from '@core/primitives/app-settings/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { hostDependencyStore } from '@main/core/dependencies/host-dependency-store';
import { OverrideSettings } from './override-settings';
import {
  migrateProviderConfigOverrides,
  migrateProviderConfigToHostDependencyStore,
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
  providerOverrideSettings: ProviderOverrideSettings
): Promise<void> {
  const raw = await providerOverrideSettings.getRawOverrides();
  await migrateProviderConfigToHostDependencyStore(raw, hostDependencyStore);
  providerOverrideSettings.invalidateCache();
}
