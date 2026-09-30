import {
  integrationPluginRegistry,
  type IntegrationCredentials,
  type VerifyResult,
} from '@emdash/plugins/integrations';
import type { Logger } from '@emdash/shared/logger';
import type { ConnectionStatus } from '@core/primitives/issue-providers/api';
import type { ProviderAccount } from '@core/services/provider-accounts/api/provider-account-store';

type Identity = Pick<
  NonNullable<Extract<VerifyResult, { connected: true }>['account']>,
  'id' | 'scope' | 'host'
>;

export function accountIdentity(account: ProviderAccount): Identity | undefined {
  const meta = account.meta;
  return meta?.providerAccountId
    ? { id: meta.providerAccountId, scope: meta.identityScope, host: meta.host }
    : undefined;
}

export function identityScope(integrationId: string, identity: Identity): string {
  return identity.scope ?? identity.host ?? integrationId;
}

export function sameIdentity(integrationId: string, left: Identity, right: Identity): boolean {
  return (
    left.id === right.id &&
    identityScope(integrationId, left) === identityScope(integrationId, right)
  );
}

/** Health observes credentials and stable identity; it never writes either back. */
export async function checkIntegrationConnection(
  integrationId: string,
  capabilities: ConnectionStatus['capabilities'],
  logger: Logger,
  loadAccount: () => Promise<{
    credentials: IntegrationCredentials;
    identity?: Identity;
    label?: string;
  } | null>
): Promise<ConnectionStatus> {
  const plugin = integrationPluginRegistry.get(integrationId);
  if (!plugin)
    return { connected: false, error: `Unknown integration: ${integrationId}`, capabilities };
  try {
    const account = await loadAccount();
    if (!account) return { connected: false, capabilities };
    const result = await plugin.behavior.auth?.verify({ log: logger }, account.credentials);
    if (!result?.connected) return { connected: false, error: result?.error, capabilities };
    if (
      account.identity &&
      (!result.account || !sameIdentity(integrationId, account.identity, result.account))
    ) {
      return {
        connected: false,
        error: 'These credentials belong to a different account.',
        capabilities,
      };
    }
    return {
      connected: true,
      displayName: account.label ?? result.displayName,
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
