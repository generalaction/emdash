import type { Provider } from '../types';
import { isValidProviderId } from '@shared/providers/registry';

const STORAGE_KEYS = {
  lastProvider: 'workspaceModal:lastProvider',
  lastProviders: 'workspaceModal:lastProviders',
  lastMultiEnabled: 'workspaceModal:lastMultiEnabled',
  lastRunsPerProvider: 'workspaceModal:lastRunsPerProvider',
} as const;

export interface WorkspaceModalPreferences {
  provider: Provider;
  providers: Provider[];
  multiEnabled: boolean;
  runsPerProvider: number;
}

/**
 * Load last used provider preferences from localStorage.
 * Returns null if no preferences exist or if saved data is invalid.
 */
export function loadWorkspaceModalPreferences(): WorkspaceModalPreferences | null {
  try {
    const lastProvider = localStorage.getItem(STORAGE_KEYS.lastProvider);
    const lastProvidersJson = localStorage.getItem(STORAGE_KEYS.lastProviders);
    const lastMultiEnabled = localStorage.getItem(STORAGE_KEYS.lastMultiEnabled);
    const lastRunsPerProvider = localStorage.getItem(STORAGE_KEYS.lastRunsPerProvider);

    // If nothing is saved, return null
    if (!lastProvider && !lastProvidersJson && !lastMultiEnabled && !lastRunsPerProvider) {
      return null;
    }

    const multiEnabled = lastMultiEnabled === 'true';

    // Validate single provider
    let provider: Provider | null = null;
    if (lastProvider && isValidProviderId(lastProvider)) {
      provider = lastProvider as Provider;
    }

    // Validate multi-providers array
    let providers: Provider[] = [];
    if (lastProvidersJson) {
      try {
        const parsed = JSON.parse(lastProvidersJson);
        if (Array.isArray(parsed)) {
          providers = parsed.filter((p) => isValidProviderId(p)) as Provider[];
        }
      } catch {
        // Invalid JSON, ignore
      }
    }

    // Validate runsPerProvider
    let runsPerProvider = 1;
    if (lastRunsPerProvider) {
      const parsed = parseInt(lastRunsPerProvider, 10);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= 10) {
        runsPerProvider = parsed;
      }
    }

    // If we have valid data, return it
    if (provider || providers.length > 0) {
      return {
        provider: provider || ('claude' as Provider),
        providers: providers.length > 0 ? providers : [provider || ('claude' as Provider), 'codex'],
        multiEnabled,
        runsPerProvider,
      };
    }
  } catch {
    // Ignore errors, return null
  }

  return null;
}

/**
 * Save provider preferences to localStorage.
 */
export function saveWorkspaceModalPreferences(
  provider: Provider,
  providers: Provider[],
  multiEnabled: boolean,
  runsPerProvider: number
): void {
  try {
    localStorage.setItem(STORAGE_KEYS.lastProvider, provider);
    localStorage.setItem(STORAGE_KEYS.lastProviders, JSON.stringify(providers));
    localStorage.setItem(STORAGE_KEYS.lastMultiEnabled, String(multiEnabled));
    localStorage.setItem(STORAGE_KEYS.lastRunsPerProvider, String(runsPerProvider));
  } catch {
    // Ignore errors (e.g., localStorage quota exceeded)
  }
}
