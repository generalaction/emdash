import type { InstallMethod } from '@emdash/core/deps';
import type { DependencyId, HostDependencySelection } from '@emdash/core/deps/runtime';
import type { ProviderCustomConfig } from '@shared/core/app-settings';
import type { IHostDependencyStore } from '../dependencies/host-dependency-store';

export function migrateProviderConfigOverrides(
  overrides: Record<string, Partial<ProviderCustomConfig>>
): Record<string, Partial<ProviderCustomConfig>> {
  // Old stored configs with extra fields (cli, path, installSource, resumeFlag, etc.) are
  // stripped by Zod schema validation. No synchronous migration logic needed here.
  // See migrateProviderConfigToHostDependencyStore for the async host-store migration.
  return overrides;
}

/**
 * One-time async migration: reads legacy cli/path/installSource fields from raw
 * provider config overrides (before Zod strips them) and writes them into the
 * host-dependency store under the 'local' host. Call once at app startup before
 * the first dependency probe.
 */
export async function migrateProviderConfigToHostDependencyStore(
  rawOverrides: Record<string, Record<string, unknown>>,
  store: IHostDependencyStore
): Promise<void> {
  const migrations: Promise<void>[] = [];

  for (const [providerId, config] of Object.entries(rawOverrides)) {
    const cli = typeof config['cli'] === 'string' ? config['cli'] : undefined;
    const path = typeof config['path'] === 'string' ? config['path'] : undefined;
    const installSource =
      typeof config['installSource'] === 'string' ? config['installSource'] : undefined;

    if (!cli && !path && !installSource) continue;

    let selection: HostDependencySelection = null;
    if (installSource === 'path' && path) {
      selection = { kind: 'path', path };
    } else if (installSource === 'cli' && cli) {
      selection = { kind: 'cli', command: cli };
    } else if (installSource && installSource !== 'path' && installSource !== 'cli') {
      selection = { kind: 'method', method: installSource as InstallMethod };
    } else if (path) {
      selection = { kind: 'path', path };
    } else if (cli) {
      selection = { kind: 'cli', command: cli };
    }

    if (selection !== null) {
      migrations.push(store.setSelection('local', providerId as DependencyId, selection));
    }
  }

  await Promise.allSettled(migrations);
}
