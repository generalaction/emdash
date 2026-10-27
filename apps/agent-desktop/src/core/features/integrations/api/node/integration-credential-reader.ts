import { normalizeRepositoryHost } from '@agent/core/primitives/repository/api';
import type { IntegrationCredentials } from '@agent/plugins/integrations';
import { err, ok, type Result } from '@agent/shared';
import type { ProviderAccountStore } from '@core/services/provider-accounts/api/provider-account-store';
import type { IntegrationAccountReader } from './integration-accounts';

export type IntegrationCredentialError =
  | { type: 'auth_required'; host: string; message: string; hint?: string }
  | { type: 'account_not_found'; host: string; accountId: string; message: string; hint?: string }
  | {
      type: 'account_host_mismatch';
      host: string;
      accountId: string;
      accountHost: string;
      message: string;
      hint?: string;
    }
  | { type: 'token_missing'; host: string; accountId: string; message: string; hint?: string };

export type ReadIntegrationCredentials = (
  integrationId: string,
  accountId: string,
  expectedHost: string
) => Promise<Result<IntegrationCredentials, IntegrationCredentialError>>;

/**
 * Reads one already-selected account's credential record for a repository
 * host. Fails closed when the account's verified host differs from the
 * repository's. `overrides` replaces the reader for an integration (GitHub's
 * also checks that its API base URL is on the repository host).
 */
export function createIntegrationCredentialReader(
  credentials: IntegrationAccountReader,
  accountLookup: Pick<ProviderAccountStore, 'getAccount'>,
  overrides: Partial<Record<string, ReadIntegrationCredentials>> = {}
): ReadIntegrationCredentials {
  return async (integrationId, accountId, expectedHost) => {
    const override = overrides[integrationId];
    if (override) return await override(integrationId, accountId, expectedHost);

    const host = normalizeRepositoryHost(expectedHost);
    const selectedId = accountId.trim();
    const stored = selectedId ? await credentials.getAccount(integrationId, selectedId) : null;
    if (!stored) {
      const exists = selectedId ? await accountLookup.getAccount(integrationId, selectedId) : null;
      return err(
        exists
          ? {
              type: 'token_missing',
              host,
              accountId: selectedId,
              message: `The selected ${integrationId} account ${selectedId} is missing saved credentials.`,
            }
          : {
              type: 'account_not_found',
              host,
              accountId: selectedId,
              message: `The selected ${integrationId} account is no longer connected: ${selectedId}.`,
            }
      );
    }
    const accountHost = stored.identity?.host;
    if (accountHost && normalizeRepositoryHost(accountHost) !== host) {
      return err({
        type: 'account_host_mismatch',
        host,
        accountId: selectedId,
        accountHost,
        message: `The selected ${integrationId} account ${selectedId} is for ${accountHost}, but this repository uses ${host}.`,
      });
    }
    return ok(stored.credentials);
  };
}
