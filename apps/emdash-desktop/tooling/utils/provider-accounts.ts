/**
 * Test utilities for provider-account DB integration tests (main-db project).
 *
 * Opens a real SQLite fixture and wires a real ProviderAccountRegistry to it.
 * Only the secret store is in-memory, because encryptedAppSecretsStore depends
 * on Electron safeStorage which is unavailable under plain Node.
 */

import { log } from '@emdash/shared/logger';
import { IntegrationAccountStore } from '@core/features/integrations/node/integration-account-store';
import { IntegrationConnectionService } from '@core/features/integrations/node/integration-connection-service';
import type { TelemetryService } from '@core/primitives/telemetry/api/telemetry';
import type { ProviderAccountSecretStore } from '@core/services/provider-accounts/api/provider-account-store';
import { ProviderAccountRegistry } from '@main/core/provider-accounts/provider-account-registry';
import { openFixture, type FixtureDb } from './db';

export class InMemorySecretStore implements ProviderAccountSecretStore {
  readonly secrets = new Map<string, string>();

  async getSecret(key: string): Promise<string | null> {
    return this.secrets.get(key) ?? null;
  }

  async setSecret(key: string, value: string): Promise<void> {
    this.secrets.set(key, value);
  }

  async deleteSecret(key: string): Promise<void> {
    this.secrets.delete(key);
  }
}

export type RegistryFixture = FixtureDb & {
  registry: ProviderAccountRegistry;
  secretStore: InMemorySecretStore;
  integrationAccounts: IntegrationAccountStore;
  connections: IntegrationConnectionService;
};

/** Open a fixture database with a real ProviderAccountRegistry on top of it. */
export async function openRegistryFixture(
  name: Parameters<typeof openFixture>[0] = 'empty',
  connectionHooks: {
    telemetry?: Pick<TelemetryService, 'capture'>;
    onAccountsChanged?: (providerId: string) => void;
  } = {}
): Promise<RegistryFixture> {
  const fixture = await openFixture(name);
  const secretStore = new InMemorySecretStore();
  const registry = new ProviderAccountRegistry(fixture.db, secretStore);
  const integrationAccounts = new IntegrationAccountStore(registry);
  const connections = new IntegrationConnectionService(
    registry,
    integrationAccounts,
    connectionHooks.telemetry ?? { capture: () => {} },
    log,
    connectionHooks.onAccountsChanged
  );
  return { ...fixture, registry, secretStore, integrationAccounts, connections };
}
