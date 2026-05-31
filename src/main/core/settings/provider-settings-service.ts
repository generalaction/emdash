import type { ProviderCustomConfig } from '@shared/app-settings';
import { OverrideSettings } from './override-settings';
import { migrateProviderConfigOverrides } from './provider-config-migrations';
import { providerConfigDefaults, providerCustomConfigEntrySchema } from './schema';

export const providerOverrideSettings = new OverrideSettings<ProviderCustomConfig>(
  'providerConfigs',
  () => providerConfigDefaults as Record<string, ProviderCustomConfig>,
  providerCustomConfigEntrySchema,
  migrateProviderConfigOverrides
);
