import type { IntegrationCredentials } from '@emdash/plugins/integrations';
import { integrationPluginRegistry } from '@emdash/plugins/integrations';
import type { Logger } from '@emdash/shared/logger';
import type {
  IntegrationAccountSummary,
  IntegrationRemoveAccountResponse,
  IntegrationSetDefaultAccountResponse,
} from '@core/primitives/integrations/api';
import type { ConnectionStatus } from '@core/primitives/issue-providers/api';
import type { TelemetryService } from '@core/primitives/telemetry/api/telemetry';
import { DEFAULT_INTEGRATION_ACCOUNT_ID } from './integration-credential-store';
import type {
  IntegrationAccountRecord,
  IntegrationCredentialStore,
} from './integration-credential-store';

type VerifiedIdentity = {
  account?: { id: string; host?: string };
  displayName?: string;
  displayDetail?: string;
  credentials?: IntegrationCredentials;
};

type ConnectResult =
  | {
      success: true;
      displayName?: string;
      displayDetail?: string;
      accountId: string;
      providerAccountStatus: 'created' | 'updated';
    }
  | { success: false; error: string };

export class IntegrationConnectionService {
  // Serializes connect + checkConnection per integration so a concurrent
  // reconnect cannot interleave with the legacy-default migration and clobber a
  // freshly written credential (the migration's check/write is not atomic).
  private readonly providerLocks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly credentials: IntegrationCredentialStore,
    private readonly telemetry: TelemetryService,
    private readonly logger: Logger
  ) {}

  private withProviderLock<T>(integrationId: string, run: () => Promise<T>): Promise<T> {
    const prior = this.providerLocks.get(integrationId) ?? Promise.resolve();
    const next = prior.then(run, run);
    this.providerLocks.set(
      integrationId,
      next.catch(() => undefined)
    );
    return next;
  }

  connect(integrationId: string, credentials: IntegrationCredentials): Promise<ConnectResult> {
    return this.withProviderLock(integrationId, () =>
      this.connectLocked(integrationId, credentials)
    );
  }

  private async connectLocked(
    integrationId: string,
    credentials: IntegrationCredentials
  ): Promise<ConnectResult> {
    const plugin = integrationPluginRegistry.get(integrationId);
    if (!plugin) return { success: false, error: `Unknown integration: ${integrationId}` };

    const result = await plugin.behavior.auth?.verify({ log: this.logger }, credentials);
    if (!result?.connected) {
      return {
        success: false,
        error: result?.error ?? `Failed to connect ${plugin.metadata.name}.`,
      };
    }

    const accountId = result.account
      ? `${result.account.host ?? integrationId}:${result.account.id}`
      : DEFAULT_INTEGRATION_ACCOUNT_ID;
    const providerAccountStatus = await this.credentials.upsertAccount(integrationId, {
      accountId,
      ...(result.displayName ? { displayName: result.displayName } : {}),
      ...(result.displayDetail ? { workspaceLabel: result.displayDetail } : {}),
      credentials: result.credentials ?? credentials,
    });
    this.telemetry.capture('integration_connected', { provider: integrationId });

    return {
      success: true,
      displayName: result.displayName,
      displayDetail: result.displayDetail,
      accountId,
      providerAccountStatus,
    };
  }

  disconnect(integrationId: string): Promise<{ success: boolean; error?: string }> {
    return this.withProviderLock(integrationId, async () => {
      try {
        await this.credentials.delete(integrationId);
        this.telemetry.capture('integration_disconnected', { provider: integrationId });
        return { success: true };
      } catch (error) {
        this.logger.error('Failed to disconnect integration', { integrationId, error });
        return { success: false, error: 'Unable to remove credentials from secure storage.' };
      }
    });
  }

  async listAccounts(integrationId: string): Promise<IntegrationAccountSummary[]> {
    return this.credentials.listAccounts(integrationId);
  }

  setDefaultAccount(
    integrationId: string,
    accountId: string
  ): Promise<IntegrationSetDefaultAccountResponse> {
    return this.withProviderLock(integrationId, async () => {
      const updated = await this.credentials.setDefaultAccount(integrationId, accountId);
      if (!updated) return { success: false, error: 'Account not found.' };
      const accounts = await this.credentials.listAccounts(integrationId);
      const account = accounts.find((candidate) => candidate.accountId === accountId);
      if (!account) return { success: false, error: 'Account not found.' };
      return { success: true, account };
    });
  }

  removeAccount(
    integrationId: string,
    accountId: string
  ): Promise<IntegrationRemoveAccountResponse> {
    if (!accountId) return Promise.resolve({ success: false, error: 'An account id is required.' });
    return this.withProviderLock(integrationId, async () => {
      try {
        await this.credentials.delete(integrationId, accountId);
        this.telemetry.capture('integration_disconnected', { provider: integrationId });
        return { success: true, accounts: await this.credentials.listAccounts(integrationId) };
      } catch (error) {
        this.logger.error('Failed to remove integration account', {
          integrationId,
          accountId,
          error,
        });
        return { success: false, error: 'Unable to remove credentials from secure storage.' };
      }
    });
  }

  checkConnection(
    integrationId: string,
    capabilities: ConnectionStatus['capabilities'],
    accountId?: string
  ): Promise<ConnectionStatus> {
    return this.withProviderLock(integrationId, () =>
      this.checkConnectionLocked(integrationId, capabilities, accountId)
    );
  }

  private async checkConnectionLocked(
    integrationId: string,
    capabilities: ConnectionStatus['capabilities'],
    accountId?: string
  ): Promise<ConnectionStatus> {
    const plugin = integrationPluginRegistry.get(integrationId);
    if (!plugin) {
      return {
        connected: false,
        error: `Unknown integration: ${integrationId}`,
        capabilities,
      };
    }

    const account = await this.credentials.getAccount(integrationId, accountId);
    if (!account) return { connected: false, capabilities };

    try {
      const result = await plugin.behavior.auth?.verify({ log: this.logger }, account.credentials);
      if (!result?.connected) {
        return { connected: false, error: result?.error, capabilities };
      }
      const migrated = await this.reidentifyLegacyDefault(integrationId, account, result);
      if (!migrated && result.credentials) {
        await this.credentials.upsertAccount(integrationId, {
          ...account,
          credentials: result.credentials,
        });
      }
      return {
        connected: true,
        displayName: result.displayName,
        displayDetail: result.displayDetail,
        capabilities,
      };
    } catch (error) {
      return {
        connected: false,
        error: error instanceof Error ? error.message : 'Connection check failed.',
        capabilities,
      };
    }
  }

  /**
   * Migrate a legacy single-account credential stored under the `'default'` id
   * to its real per-workspace account id, using the identity `verify()` now
   * returns. Resumable and collision-safe: the destination is written before the
   * `'default'` row is removed; if the destination already exists (the user
   * already connected that workspace) the stale `'default'` row is just dropped
   * without overwriting the good credential. Returns true when it handled the
   * account; false (fail-open) leaves `'default'` intact for the caller.
   */
  private async reidentifyLegacyDefault(
    integrationId: string,
    account: IntegrationAccountRecord,
    result: VerifiedIdentity
  ): Promise<boolean> {
    if (account.accountId !== DEFAULT_INTEGRATION_ACCOUNT_ID || !result.account) return false;
    const canonicalId = `${result.account.host ?? integrationId}:${result.account.id}`;
    if (canonicalId === DEFAULT_INTEGRATION_ACCOUNT_ID) return false;

    try {
      const wasDefault =
        (await this.credentials.getDefaultAccountId(integrationId)) ===
        DEFAULT_INTEGRATION_ACCOUNT_ID;
      const existing = await this.credentials.getAccount(integrationId, canonicalId);
      if (!existing) {
        await this.credentials.upsertAccount(integrationId, {
          accountId: canonicalId,
          ...(result.displayName ? { displayName: result.displayName } : {}),
          ...(result.displayDetail ? { workspaceLabel: result.displayDetail } : {}),
          credentials: result.credentials ?? account.credentials,
        });
      }
      // Preserve the default selection before removing the legacy row — in both
      // branches, so deleting 'default' never lets the registry promote a
      // different surviving account as the new default.
      if (wasDefault) await this.credentials.setDefaultAccount(integrationId, canonicalId);
      await this.credentials.delete(integrationId, DEFAULT_INTEGRATION_ACCOUNT_ID);
      return true;
    } catch (error) {
      this.logger.warn('Failed to re-identify legacy default integration account', {
        integrationId,
        canonicalId,
        error,
      });
      return false;
    }
  }
}

let integrationConnectionService: IntegrationConnectionService | undefined;

export function setIntegrationConnectionService(service: IntegrationConnectionService): void {
  integrationConnectionService = service;
}

export function getIntegrationConnectionService(): IntegrationConnectionService {
  if (!integrationConnectionService) {
    throw new Error('Integration connection service has not been configured');
  }
  return integrationConnectionService;
}
