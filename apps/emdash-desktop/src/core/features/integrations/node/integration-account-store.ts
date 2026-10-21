import {
  integrationPluginRegistry,
  type IntegrationCredentials,
} from '@emdash/plugins/integrations';
import { KeyedMutex } from '@emdash/shared/concurrency';
import { log } from '@emdash/shared/logger';
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
  private readonly refreshes = new KeyedMutex();
  /** Stored credentials, as JSON, whose refresh the provider rejected; keyed per account. */
  private readonly rejectedRefreshes = new Map<string, string>();
  /** Refreshed credentials that failed to persist, valid while the stored JSON is `replaces`. */
  private readonly unsavedRefreshes = new Map<
    string,
    { replaces: string; credentials: IntegrationCredentials }
  >();

  constructor(
    private readonly accounts: ProviderAccountStore,
    readonly prepare: (providerId: string) => Promise<void> = async () => {},
    private readonly now: () => number = Date.now
  ) {}

  /**
   * Resolve one account: by id when given, otherwise the integration's
   * default account. Credentials the integration can refresh are refreshed
   * and persisted first when they are near expiry; refreshes are serialized
   * per account because rotating refresh tokens are single-use. A failed
   * refresh returns the stored credentials, so the API call reports the
   * authentication failure. Credentials whose refresh was rejected are not
   * refreshed again until they change. Refreshed credentials that fail to
   * persist are kept in memory and written again on the next read, because
   * the provider has already invalidated the stored refresh token. A refresh
   * is saved only while the stored credentials it replaces are unchanged, so
   * a disconnect or reconnect during the request wins.
   */
  async getAccount(
    integrationId: string,
    accountId?: string
  ): Promise<IntegrationAccountRecord | null> {
    await this.prepare(integrationId);
    const account = await this.accounts.getAccount(integrationId, accountId);
    if (!account) return null;

    const auth = integrationPluginRegistry.get(integrationId)?.behavior.auth;
    if (!auth?.refreshCredentials) {
      const credentials = await this.readCredentials(integrationId, account.accountId);
      return credentials ? toIntegrationAccount(account, credentials) : null;
    }
    const refresh = auth.refreshCredentials.bind(auth);
    const key = `${integrationId}\u0000${account.accountId}`;
    const credentials = await this.refreshes.runExclusive(key, async () => {
      const persisted = await this.readCredentials(integrationId, account.accountId);
      if (!persisted) {
        this.unsavedRefreshes.delete(key);
        return null;
      }
      let persistedJson = JSON.stringify(persisted);
      let stored = persisted;
      const unsaved = this.unsavedRefreshes.get(key);
      if (unsaved?.replaces === persistedJson) {
        stored = unsaved.credentials;
        const saved = await this.saveRefreshed(
          integrationId,
          account.accountId,
          stored,
          persistedJson
        );
        if (saved === 'superseded') {
          this.unsavedRefreshes.delete(key);
          return await this.readCredentials(integrationId, account.accountId);
        }
        if (saved === 'saved') {
          this.unsavedRefreshes.delete(key);
          persistedJson = JSON.stringify(stored);
        }
      } else if (unsaved) {
        this.unsavedRefreshes.delete(key);
      }
      const storedJson = JSON.stringify(stored);
      if (this.rejectedRefreshes.get(key) === storedJson) return stored;
      const refreshed = await refresh({ log }, stored, this.now());
      if (!refreshed.success) {
        log.warn('IntegrationAccountStore: credential refresh failed', {
          integrationId,
          accountId: account.accountId,
          error: refreshed.error.type,
        });
        if (refreshed.error.type === 'auth_failed') this.rejectedRefreshes.set(key, storedJson);
        return stored;
      }
      this.rejectedRefreshes.delete(key);
      if (!refreshed.data) return stored;
      const saved = await this.saveRefreshed(
        integrationId,
        account.accountId,
        refreshed.data,
        persistedJson
      );
      if (saved === 'failed') {
        this.unsavedRefreshes.set(key, { replaces: persistedJson, credentials: refreshed.data });
        return refreshed.data;
      }
      this.unsavedRefreshes.delete(key);
      if (saved === 'superseded') {
        return await this.readCredentials(integrationId, account.accountId);
      }
      return refreshed.data;
    });
    return credentials ? toIntegrationAccount(account, credentials) : null;
  }

  /** Writes `credentials` unless the stored credentials no longer match `replaces`. */
  private async saveRefreshed(
    integrationId: string,
    accountId: string,
    credentials: IntegrationCredentials,
    replaces: string
  ): Promise<'saved' | 'superseded' | 'failed'> {
    try {
      const current = await this.readCredentials(integrationId, accountId);
      if (!current || JSON.stringify(current) !== replaces) return 'superseded';
      await this.writeCredentials(integrationId, accountId, credentials);
      return 'saved';
    } catch (error) {
      log.error('IntegrationAccountStore: refreshed credentials were not saved', {
        integrationId,
        accountId,
        error: error instanceof Error ? error.name : 'unknown',
      });
      return 'failed';
    }
  }

  private async readCredentials(
    integrationId: string,
    accountId: string
  ): Promise<IntegrationCredentials | null> {
    const raw = await this.accounts.resolveSecret(integrationId, accountId);
    const schema = integrationPluginRegistry.get(integrationId)?.behavior.auth?.credentialsSchema;
    const credentials = schema?.safeParse(raw ? parseJson(raw) : null);
    return credentials?.success ? credentials.data : null;
  }

  /** Replaces only the secret; account metadata is untouched. */
  private async writeCredentials(
    integrationId: string,
    accountId: string,
    credentials: IntegrationCredentials
  ): Promise<void> {
    const schema = integrationPluginRegistry.get(integrationId)?.behavior.auth?.credentialsSchema;
    const parsed = schema?.safeParse(credentials);
    if (!parsed?.success) throw new Error(`Invalid ${integrationId} credentials`);
    await this.accounts.upsertAccount({
      providerId: integrationId,
      accountId,
      secret: JSON.stringify(parsed.data),
    });
  }

  /** Serialized with refreshes of the same account. */
  async upsertAccount(integrationId: string, account: IntegrationAccountRecord) {
    return await this.refreshes.runExclusive(`${integrationId}\u0000${account.accountId}`, () =>
      this.writeAccount(integrationId, account)
    );
  }

  private async writeAccount(integrationId: string, account: IntegrationAccountRecord) {
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
