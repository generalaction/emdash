import type { ProviderCustomConfig } from '@core/primitives/app-settings/api';
import { hostDependencyStore } from '@main/core/dependencies/host-dependency-store';
import { OverrideSettings } from './override-settings';
import {
  migrateProviderConfigOverrides,
  migrateProviderConfigToHostDependencyStore,
} from './provider-config-migrations';
import { providerConfigDefaults, providerCustomConfigEntrySchema } from './provider-config-schema';

export const providerOverrideSettings = new OverrideSettings<ProviderCustomConfig>(
  'providerConfigs',
  () => providerConfigDefaults,
  providerCustomConfigEntrySchema,
  migrateProviderConfigOverrides
);

export async function runProviderSettingsMigration(): Promise<void> {
  const raw = await providerOverrideSettings.getRawOverrides();
  await migrateProviderConfigToHostDependencyStore(raw, hostDependencyStore);
  providerOverrideSettings.invalidateCache();
}
