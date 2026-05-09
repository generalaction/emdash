import type { ProviderCustomConfig } from '@shared/app-settings';
import { OverrideSettings } from './override-settings';
import { providerConfigDefaults, providerCustomConfigEntrySchema } from './schema';

export const providerOverrideSettings = new OverrideSettings<ProviderCustomConfig>(
  'providerConfigs',
  () => providerConfigDefaults as Record<string, ProviderCustomConfig>,
  providerCustomConfigEntrySchema
);
