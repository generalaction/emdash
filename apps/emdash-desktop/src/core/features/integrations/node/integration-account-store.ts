import {
  integrationPluginRegistry,
  type IntegrationCredentials,
} from '@emdash/plugins/integrations';
import type {
  ProviderAccount,
  ProviderAccountStore,
} from '@core/services/provider-accounts/api/provider-account-store';
import type {
  IntegrationAccountReader,
  IntegrationAccountRecord,
} from '../api/node/integration-accounts';

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** Provider-schema JSON credentials and account metadata over the shared registry. */
export class IntegrationAccountStore implements IntegrationAccountReader {
  constructor(
    private readonly accounts: ProviderAccountStore,
    readonly prepare: (providerId: string) => Promise<void> = async () => {}
  ) {}

  /**
   * Resolve one account: by id when given, otherwise the integration's
   * default account.
   */
  async getAccount(
    integrationId: string,
    accountId?: string
  ): Promise<IntegrationAccountRecord | null> {
    await this.prepare(integrationId);
    const account = await this.accounts.getAccount(integrationId, accountId);
    if (!account) return null;

    const raw = await this.accounts.resolveSecret(integrationId, account.accountId);
    const schema = integrationPluginRegistry.get(integrationId)?.behavior.auth?.credentialsSchema;
    const credentials = schema?.safeParse(raw ? parseJson(raw) : null);
    if (!credentials?.success) return null;
    return toIntegrationAccount(account, credentials.data);
  }

  async upsertAccount(integrationId: string, account: IntegrationAccountRecord) {
    const schema = integrationPluginRegistry.get(integrationId)?.behavior.auth?.credentialsSchema;
    if (!schema) throw new Error(`Unknown integration: ${integrationId}`);
    const credentials = schema.safeParse(account.credentials);
    // Do not include validation inputs (which may contain secrets) in errors.
    if (!credentials.success) throw new Error(`Invalid ${integrationId} credentials`);
    return this.accounts.upsertAccount({
      providerId: integrationId,
      accountId: account.accountId,
      secret: JSON.stringify(credentials.data),
      meta: {
        ...(account.displayName ? { displayName: account.displayName } : {}),
        ...(account.label ? { label: account.label } : {}),
        ...(account.displayDetail ? { displayDetail: account.displayDetail } : {}),
        ...(account.credentialSource ? { credentialSource: account.credentialSource } : {}),
        ...(account.identity
          ? {
              providerAccountId: account.identity.id,
              identityScope: account.identity.scope ?? account.identity.host ?? integrationId,
              login: account.identity.login,
              host: account.identity.host,
              avatarUrl: account.identity.avatarUrl,
            }
          : {}),
      },
    });
  }
}

function toIntegrationAccount(
  account: ProviderAccount,
  credentials: IntegrationCredentials
): IntegrationAccountRecord {
  return {
    accountId: account.accountId,
    ...(account.meta?.displayName ? { displayName: account.meta.displayName } : {}),
    ...(account.meta?.label ? { label: account.meta.label } : {}),
    ...(account.meta?.displayDetail ? { displayDetail: account.meta.displayDetail } : {}),
    ...(account.meta?.credentialSource ? { credentialSource: account.meta.credentialSource } : {}),
    ...(account.meta?.providerAccountId
      ? {
          identity: {
            id: account.meta.providerAccountId,
            ...(account.meta.login ? { login: account.meta.login } : {}),
            ...(account.meta.host ? { host: account.meta.host } : {}),
            ...(account.meta.identityScope ? { scope: account.meta.identityScope } : {}),
            ...(account.meta.avatarUrl ? { avatarUrl: account.meta.avatarUrl } : {}),
          },
        }
      : {}),
    credentials,
  };
}
