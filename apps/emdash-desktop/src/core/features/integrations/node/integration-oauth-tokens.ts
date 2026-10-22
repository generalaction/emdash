import { normalizeRepositoryHost } from '@emdash/core/primitives/repository/api';
import {
  integrationPluginRegistry,
  type IntegrationPluginProvider,
} from '@emdash/plugins/integrations';
import { err, ok, type Result } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import type {
  ProviderTokenDispatchResult,
  ProviderTokenPayload,
  ProviderTokenSink,
} from '@core/features/account/api/node/provider-token-sink';
import type { IntegrationConnections } from '../api/node/integration-accounts';
import type { CredentialRenewer } from './integration-account-store';

/** Accounts connected with an access token issued by the Emdash auth server. */
export const EMDASH_OAUTH_CREDENTIAL_SOURCE = 'emdash_oauth';

/** The integration offering sign-in through the Emdash auth server for `provider`. */
function findOAuthIntegration(provider: string): IntegrationPluginProvider | undefined {
  return integrationPluginRegistry
    .getAll()
    .find(
      (plugin) =>
        plugin.behavior.auth?.credentialsFromOAuthToken !== undefined &&
        plugin.capabilities.auth.methods.some(
          (method) => method.kind === 'oauth' && method.providerId === provider
        )
    );
}

/**
 * Connects accounts from provider tokens issued at Emdash sign-in or account
 * linking. Tokens are verified with the provider like every other connection
 * method, so an account gets the same identity whichever method connected it.
 */
export class IntegrationOAuthTokens implements ProviderTokenSink {
  constructor(
    private readonly connections: IntegrationConnections,
    private readonly logger: Logger
  ) {}

  supports(provider: string): boolean {
    return findOAuthIntegration(provider) !== undefined;
  }

  async store(
    provider: string,
    payload: ProviderTokenPayload
  ): Promise<ProviderTokenDispatchResult | undefined> {
    const integration = findOAuthIntegration(provider);
    const auth = integration?.behavior.auth;
    const providerAccount = payload.providerAccount;
    if (!integration || !auth?.credentialsFromOAuthToken || !providerAccount) return undefined;

    const { name } = integration.metadata;
    const credentials = auth.credentialsFromOAuthToken({
      accessToken: payload.accessToken,
      ...(payload.expiresAt !== undefined ? { expiresAt: payload.expiresAt } : {}),
      host: normalizeRepositoryHost(providerAccount.host),
    });
    const verified = await auth.verify({ log: this.logger }, credentials);
    if (!verified.connected) {
      throw new Error(verified.error ?? `Could not verify the ${name} account.`);
    }
    if (verified.account?.id !== providerAccount.providerAccountId) {
      throw new Error(`The ${name} token belongs to a different account.`);
    }
    const result = await this.connections.connectVerified(integration.metadata.id, verified, {
      credentialSource: EMDASH_OAUTH_CREDENTIAL_SOURCE,
    });
    if (!result.success) throw new Error(result.error);
    return { providerAccountStatus: result.status, providerAccount };
  }
}

export type RenewEmdashProviderToken = (
  provider: string,
  providerAccountId: string
) => Promise<
  Result<{ accessToken: string; expiresAt?: number }, { type: string; message: string }>
>;

/** Renews access tokens issued by the Emdash auth server, which keeps their refresh tokens. */
export function createEmdashOAuthRenewer(renewToken: RenewEmdashProviderToken): CredentialRenewer {
  return async (integrationId, account) => {
    const plugin = integrationPluginRegistry.get(integrationId);
    const auth = plugin?.behavior.auth;
    const method = plugin?.capabilities.auth.methods.find(
      (candidate) => candidate.kind === 'oauth'
    );
    const identity = account.identity;
    if (!plugin || !auth?.credentialsFromOAuthToken || method?.kind !== 'oauth' || !identity?.host)
      return ok();

    const { name } = plugin.metadata;
    const token = await renewToken(method.providerId, identity.id);
    if (!token.success) {
      switch (token.error.type) {
        case 'not_signed_in':
        case 'session_expired':
          return err({
            type: 'unavailable',
            message: `Sign in to Emdash to keep ${name} connected.`,
          });
        case 'provider_account_not_linked':
          return err({
            type: 'rejected',
            message: `${name} is no longer linked to your Emdash account. Reconnect ${name}.`,
          });
        default:
          return err({
            type: 'unavailable',
            message: `Could not renew ${name} access: ${token.error.message}`,
          });
      }
    }
    return ok(
      auth.credentialsFromOAuthToken({
        accessToken: token.data.accessToken,
        ...(token.data.expiresAt !== undefined ? { expiresAt: token.data.expiresAt } : {}),
        host: identity.host,
      })
    );
  };
}
