import { normalizeRepositoryHost } from '@agent/core/primitives/repository/api';
import {
  integrationPluginRegistry,
  type IntegrationPluginProvider,
} from '@agent/plugins/integrations';
import { err, ok, type Result } from '@agent/shared';
import type { Logger } from '@agent/shared/logger';
import type { Clock } from '@agent/shared/scheduling';
import type {
  ProviderTokenDispatchResult,
  ProviderTokenPayload,
  ProviderTokenSink,
  ProviderTokenTarget,
} from '@core/features/account/api/node/provider-token-sink';
import type { IntegrationConnections } from '../api/node/integration-accounts';
import type { CredentialRenewer } from './integration-account-store';
import { verifyFreshCredentials } from './verify-fresh-credentials';

/** Accounts connected with an access token issued by the Agent auth server. */
export const AGENT_OAUTH_CREDENTIAL_SOURCE = 'emdash_oauth';

/** The integration offering sign-in through the Agent auth server for `provider`. */
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
 * Connects accounts from provider tokens issued at Agent sign-in or account
 * linking. Tokens are verified with the provider like every other connection
 * method, so an account gets the same identity whichever method connected it.
 */
export class IntegrationOAuthTokens implements ProviderTokenSink {
  constructor(
    private readonly connections: IntegrationConnections,
    private readonly logger: Logger,
    private readonly clock?: Pick<Clock, 'sleep'>
  ) {}

  supports(provider: string): boolean {
    return findOAuthIntegration(provider) !== undefined;
  }

  async store(
    provider: string,
    payload: ProviderTokenPayload,
    target: ProviderTokenTarget = {}
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
    const verified = await verifyFreshCredentials(
      async () => await auth.verify({ log: this.logger }, credentials),
      this.clock ? { clock: this.clock } : {}
    );
    if (!verified.connected) {
      throw new Error(verified.error ?? `Could not verify the ${name} account.`);
    }
    if (verified.account?.id !== providerAccount.providerAccountId) {
      throw new Error(`The ${name} token belongs to a different account.`);
    }
    // Reconnecting an account rejects a token for another identity.
    const result = await this.connections.connectVerified(integration.metadata.id, verified, {
      ...(target.accountId ? { accountId: target.accountId } : {}),
      credentialSource: AGENT_OAUTH_CREDENTIAL_SOURCE,
    });
    if (!result.success) throw new Error(result.error);
    return { providerAccountStatus: result.status, providerAccount };
  }
}

export type RenewAgentProviderToken = (
  provider: string,
  providerAccountId: string
) => Promise<
  Result<{ accessToken: string; expiresAt?: number }, { type: string; message: string }>
>;

/** Renews access tokens issued by the Agent auth server, which keeps their refresh tokens. */
export function createAgentOAuthRenewer(renewToken: RenewAgentProviderToken): CredentialRenewer {
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
            message: `Sign in to Agent to keep ${name} connected.`,
          });
        case 'provider_account_not_linked':
          return err({
            type: 'rejected',
            message: `${name} is no longer linked to your Agent account. Reconnect ${name}.`,
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
