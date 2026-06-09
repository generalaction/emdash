import type { ProviderCustomConfig } from '@shared/core/app-settings';
import { createRPCController } from '@shared/lib/ipc/rpc';
import { providerOverrideSettings } from './provider-settings-service';

export const providerSettingsController = createRPCController({
  getAll: (): Promise<Record<string, ProviderCustomConfig>> => providerOverrideSettings.getAll(),

  getItem: (id: string): Promise<ProviderCustomConfig | undefined> =>
    providerOverrideSettings.getItem(id),

  getItemWithMeta: (
    id: string
  ): Promise<{
    value: ProviderCustomConfig;
    defaults: ProviderCustomConfig;
    overrides: Partial<ProviderCustomConfig>;
  } | null> => providerOverrideSettings.getItemWithMeta(id),

  updateItem: (id: string, config: Partial<ProviderCustomConfig>): Promise<void> =>
    providerOverrideSettings.updateItem(id, config),

  resetItem: (id: string): Promise<void> => providerOverrideSettings.resetItem(id),

  resetAll: (): Promise<void> => providerOverrideSettings.resetAll(),
});
