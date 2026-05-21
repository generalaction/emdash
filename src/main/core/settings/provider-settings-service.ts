import { getProviderConfigDefaults } from '@shared/agent-provider-registry';
import type { ProviderCustomConfig } from '@shared/app-settings';
import { OverrideSettings } from './override-settings';
import { providerCustomConfigEntrySchema } from './schema';

export const providerOverrideSettings = new OverrideSettings<ProviderCustomConfig>(
  'providerConfigs',
  () => getProviderConfigDefaults() as Record<string, ProviderCustomConfig>,
  providerCustomConfigEntrySchema
);
