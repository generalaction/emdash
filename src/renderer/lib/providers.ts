/**
 * Utility to get provider information for the UI
 */

import { Provider } from '../types';
import { PROVIDERS } from '@shared/providers/registry';
import { providerMeta } from '../providers/meta';

export interface ProviderInfo {
  id: Provider;
  name: string;
  icon?: string;
  installCommand?: string;
  docUrl?: string;
}

/**
 * Get provider info by ID
 */
export function getProviderInfo(providerId: Provider): ProviderInfo | null {
  const provider = PROVIDERS.find(p => p.id === providerId);
  if (!provider) return null;

  const meta = providerMeta[providerId];

  return {
    id: provider.id as Provider,
    name: provider.name,
    icon: meta?.icon,
    installCommand: provider.installCommand,
    docUrl: provider.docUrl,
  };
}