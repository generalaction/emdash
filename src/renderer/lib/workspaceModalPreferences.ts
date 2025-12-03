import type { Provider } from '../types';
import type { ProviderRun } from '../types/chat';
import { isValidProviderId } from '@shared/providers/registry';

const STORAGE_KEYS = {
  providerRuns: 'workspaceModal:providerRuns',
  lastDefaultProvider: 'workspaceModal:lastDefaultProvider',
  // Legacy keys (for migration)
  lastProvider: 'workspaceModal:lastProvider',
  lastProviders: 'workspaceModal:lastProviders',
  lastMultiEnabled: 'workspaceModal:lastMultiEnabled',
  lastRunsPerProvider: 'workspaceModal:lastRunsPerProvider',
} as const;

export interface WorkspaceModalPreferences {
  providerRuns: ProviderRun[];
}

export interface LoadedWorkspaceModalPreferences {
  prefs: WorkspaceModalPreferences | null;
  defaultMatches: boolean;
}

/**
 * Load last used provider preferences from localStorage.
 * Supports migration from old format (separate provider/providers/multiEnabled/runsPerProvider).
 */
export function loadWorkspaceModalPreferences(
  currentDefaultProvider: Provider
): LoadedWorkspaceModalPreferences {
  try {
    const savedDefaultProvider = localStorage.getItem(STORAGE_KEYS.lastDefaultProvider);
    const defaultMatches = !savedDefaultProvider || savedDefaultProvider === currentDefaultProvider;

    // Try loading new format first
    const providerRunsJson = localStorage.getItem(STORAGE_KEYS.providerRuns);
    if (providerRunsJson) {
      try {
        const parsed = JSON.parse(providerRunsJson);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const validRuns = parsed.filter(
            (pr): pr is ProviderRun =>
              pr &&
              typeof pr === 'object' &&
              isValidProviderId(pr.provider) &&
              typeof pr.runs === 'number' &&
              pr.runs >= 1 &&
              pr.runs <= 5
          );
          if (validRuns.length > 0) {
            return { prefs: { providerRuns: validRuns }, defaultMatches };
          }
        }
      } catch {
        // Invalid JSON, fall through to legacy migration
      }
    }

    // Legacy migration: convert old format to new
    const lastProvider = localStorage.getItem(STORAGE_KEYS.lastProvider);
    const lastProvidersJson = localStorage.getItem(STORAGE_KEYS.lastProviders);
    const lastMultiEnabled = localStorage.getItem(STORAGE_KEYS.lastMultiEnabled);
    const lastRunsPerProvider = localStorage.getItem(STORAGE_KEYS.lastRunsPerProvider);

    // If nothing saved at all, return null
    if (!lastProvider && !lastProvidersJson && !lastMultiEnabled && !lastRunsPerProvider) {
      return { prefs: null, defaultMatches };
    }

    const multiEnabled = lastMultiEnabled === 'true';
    const runsPerProvider = Math.max(1, Math.min(5, parseInt(lastRunsPerProvider || '1', 10) || 1));

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

    // Convert to new format
    let providerRuns: ProviderRun[];
    if (multiEnabled && providers.length > 0) {
      // Multi-agent mode: each provider gets runsPerProvider runs
      providerRuns = providers.map((p) => ({ provider: p, runs: runsPerProvider }));
    } else if (provider) {
      // Single-agent mode: just the one provider with 1 run
      providerRuns = [{ provider, runs: 1 }];
    } else {
      return { prefs: null, defaultMatches };
    }

    // Clean up legacy keys and save in new format
    cleanupLegacyKeys();
    saveWorkspaceModalPreferences(providerRuns, currentDefaultProvider);

    return { prefs: { providerRuns }, defaultMatches };
  } catch {
    return { prefs: null, defaultMatches: true };
  }
}

/**
 * Save provider preferences to localStorage.
 */
export function saveWorkspaceModalPreferences(
  providerRuns: ProviderRun[],
  currentDefaultProvider: Provider
): void {
  try {
    localStorage.setItem(STORAGE_KEYS.providerRuns, JSON.stringify(providerRuns));
    localStorage.setItem(STORAGE_KEYS.lastDefaultProvider, currentDefaultProvider);
  } catch {
    // Ignore errors (e.g., localStorage quota exceeded)
  }
}

/**
 * Clear saved workspace modal preferences and store the current default provider as the baseline.
 */
export function resetWorkspaceModalPreferences(currentDefaultProvider: Provider): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.providerRuns);
    cleanupLegacyKeys();
    localStorage.setItem(STORAGE_KEYS.lastDefaultProvider, currentDefaultProvider);
  } catch {
    // Ignore errors (e.g., localStorage quota exceeded)
  }
}

/**
 * Remove legacy storage keys after migration.
 */
function cleanupLegacyKeys(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.lastProvider);
    localStorage.removeItem(STORAGE_KEYS.lastProviders);
    localStorage.removeItem(STORAGE_KEYS.lastMultiEnabled);
    localStorage.removeItem(STORAGE_KEYS.lastRunsPerProvider);
  } catch {
    // Ignore errors
  }
}
