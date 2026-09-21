import { randomUUID } from 'node:crypto';
import type { IntegrationCredentials, VerifyResult } from '@emdash/plugins/integrations';
import { integrationPluginRegistry } from '@emdash/plugins/integrations';
import type { Logger } from '@emdash/shared/logger';
import type { ConnectionStatus } from '@core/primitives/issue-providers/api';
import { toProviderAccountSummary } from '@core/primitives/provider-accounts/api';
import type { TelemetryService } from '@core/primitives/telemetry/api/telemetry';
import type {
  ProviderAccount,
  ProviderAccountStore,
} from '@core/services/provider-accounts/api/provider-account-store';
import type { IntegrationConnectOptions } from '../api/contract';
import {
  accountIdentity,
  identityScope,
  sameIdentity,
  checkIntegrationConnection,
} from '../api/node/account-verification';
import type {
  IntegrationConnectionResult,
  IntegrationConnections,
} from '../api/node/integration-accounts';
import type { IntegrationAccountStore } from './integration-account-store';
import { findMatchingLegacyAccount } from './migrations/legacy-integration-accounts';

export class IntegrationConnectionService implements IntegrationConnections {
  constructor(
    private readonly accounts: ProviderAccountStore,
    private readonly credentials: IntegrationAccountStore,
    private readonly telemetry: Pick<TelemetryService, 'capture'>,
    private readonly logger: Logger,
    private readonly onAccountsChanged?: (providerId: string) => void
  ) {}

  async connect(
    integrationId: string,
    credentials: IntegrationCredentials,
    options: IntegrationConnectOptions & { credentialSource?: string } = {}
  ): Promise<IntegrationConnectionResult> {
    const plugin = integrationPluginRegistry.get(integrationId);
    if (!plugin) return { success: false, error: `Unknown integration: ${integrationId}` };

    const result = await plugin.behavior.auth?.verify({ log: this.logger }, credentials);
    if (!result?.connected) {
      return {
        success: false,
        error: result?.error ?? `Failed to connect ${plugin.metadata.name}.`,
      };
    }

    return this.connectVerified(integrationId, result, options);
  }

  /** Trusted auth adapters may supply an identity already verified by their auth flow. */
  async connectVerified(
    integrationId: string,
    result: Extract<VerifyResult, { connected: true }>,
    options: IntegrationConnectOptions & { credentialSource?: string } = {}
  ): Promise<IntegrationConnectionResult> {
    const plugin = integrationPluginRegistry.get(integrationId);
    if (!plugin) return { success: false, error: `Unknown integration: ${integrationId}` };

    await this.credentials.prepare(integrationId);
    let existing: ProviderAccount | null = null;
    if (options.accountId) {
      existing = await this.accounts.getAccount(integrationId, options.accountId);
      if (!existing) return { success: false, error: 'Account not found. Add a new account.' };
      const identity = accountIdentity(existing);
      if (identity && (!result.account || !sameIdentity(integrationId, identity, result.account))) {
        return { success: false, error: 'These credentials belong to a different account.' };
      }
    } else if (result.account) {
      const identity = result.account;
      existing =
        (await this.accounts.listAccounts(integrationId)).find((candidate) => {
          const knownIdentity = accountIdentity(candidate);
          return knownIdentity && sameIdentity(integrationId, knownIdentity, identity);
        }) ?? null;
      if (!existing) {
        existing = await findMatchingLegacyAccount(
          integrationId,
          this.accounts,
          async (accountId) =>
            (await this.credentials.getAccount(integrationId, accountId))?.credentials ?? null,
          async (legacyCredentials) => {
            const previous = await plugin.behavior.auth?.verify(
              { log: this.logger },
              legacyCredentials
            );
            return (
              !!previous?.connected &&
              !!previous.account &&
              sameIdentity(integrationId, previous.account, identity)
            );
          }
        );
      }
    }
    const label = options.displayName?.trim() || existing?.meta?.label;
    const verifiedDisplayName = result.displayName || existing?.meta?.displayName;
    const displayName = label || verifiedDisplayName;
    if (!result.account && !displayName) {
      return {
        success: false,
        error: 'Enter an account name so you can identify this connection.',
      };
    }
    const accountId =
      existing?.accountId ??
      (result.account
        ? `${identityScope(integrationId, result.account)}:${result.account.id}`
        : `${integrationId}:${randomUUID()}`);
    const saved = await this.credentials.upsertAccount(integrationId, {
      accountId,
      ...(verifiedDisplayName ? { displayName: verifiedDisplayName } : {}),
      ...(label ? { label } : {}),
      ...(result.displayDetail ? { displayDetail: result.displayDetail } : {}),
      ...(result.account ? { identity: result.account } : {}),
      credentials: result.credentials,
      credentialSource: options.credentialSource ?? existing?.meta?.credentialSource,
    });
    this.telemetry.capture('integration_connected', { provider: integrationId });
    this.onAccountsChanged?.(integrationId);

    return {
      success: true,
      accountId,
      displayName,
      displayDetail: result.displayDetail,
      account: toProviderAccountSummary(saved.account),
      status: saved.status,
    };
  }

  async checkConnection(
    integrationId: string,
    capabilities: ConnectionStatus['capabilities'],
    accountId?: string
  ): Promise<ConnectionStatus> {
    return checkIntegrationConnection(integrationId, capabilities, this.logger, () =>
      this.credentials.getAccount(integrationId, accountId)
    );
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
