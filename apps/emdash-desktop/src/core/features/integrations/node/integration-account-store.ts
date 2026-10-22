import {
  credentialsExpireAt,
  integrationPluginRegistry,
  type IntegrationCredentials,
} from '@emdash/plugins/integrations';
import { err, type Result } from '@emdash/shared';
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

/** Credentials are renewed when they expire within this window. */
export const CREDENTIAL_RENEWAL_SKEW_MS = 5 * 60 * 1000;

export type CredentialRenewalError = {
  /** `rejected`: the grant is no longer valid; renewal waits until the credentials change. */
  type: 'rejected' | 'unavailable';
  message: string;
};

/** Renews one account's expiring credentials; `undefined` when they cannot be renewed. */
export type CredentialRenewer = (
  integrationId: string,
  account: IntegrationAccountRecord,
  now: number
) => Promise<Result<IntegrationCredentials | undefined, CredentialRenewalError>>;

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** Provider-schema JSON credentials and account metadata over the shared registry. */
export class IntegrationAccountStore implements IntegrationAccountReader {
  private readonly renewals = new KeyedMutex();
  private readonly renewers = new Map<string, CredentialRenewer>();
  /** Stored credentials, as JSON, whose renewal failed; keyed per account. */
  private readonly failedRenewals = new Map<
    string,
    { credentials: string; error: CredentialRenewalError }
  >();
  /** Renewed credentials that failed to persist, valid while the stored JSON is `replaces`. */
  private readonly unsavedRenewals = new Map<
    string,
    { replaces: string; credentials: IntegrationCredentials }
  >();

  constructor(
    private readonly accounts: ProviderAccountStore,
    readonly prepare: (providerId: string) => Promise<void> = async () => {},
    private readonly now: () => number = Date.now
  ) {}

  /**
   * Renews expiring credentials of accounts connected with `credentialSource`
   * (e.g. tokens issued by the Emdash auth server). Other expiring credentials
   * are renewed by their integration's `refreshCredentials`.
   */
  setRenewer(credentialSource: string, renewer: CredentialRenewer): void {
    this.renewers.set(credentialSource, renewer);
  }

  /**
   * Resolve one account: by id when given, otherwise the integration's
   * default account. Credentials whose `expiresAt` is near are renewed and
   * persisted first; renewals are serialized per account because rotating
   * refresh tokens are single-use. A failed renewal returns the stored
   * credentials with `renewalError`, so the API call reports the
   * authentication failure. Credentials whose renewal was rejected are not
   * renewed again until they change. Renewed credentials that fail to
   * persist are kept in memory and written again on the next read, because
   * the provider has already invalidated the stored refresh token. A renewal
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

    const renew = this.renewerFor(integrationId, account.meta?.credentialSource);
    if (!renew) {
      const credentials = await this.readCredentials(integrationId, account.accountId);
      return credentials ? toIntegrationAccount(account, credentials) : null;
    }
    const key = `${integrationId}\u0000${account.accountId}`;
    if (!this.unsavedRenewals.has(key)) {
      const credentials = await this.readCredentials(integrationId, account.accountId);
      if (!credentials) return null;
      if (!this.expiresSoon(credentials)) return toIntegrationAccount(account, credentials);
    }
    const resolved = await this.renewals.runExclusive(key, () =>
      this.renewExclusive(integrationId, account, key, renew)
    );
    if (!resolved) return null;
    return {
      ...toIntegrationAccount(account, resolved.credentials),
      ...(resolved.renewalError ? { renewalError: resolved.renewalError } : {}),
    };
  }

  private async renewExclusive(
    integrationId: string,
    account: ProviderAccount,
    key: string,
    renew: CredentialRenewer
  ): Promise<{ credentials: IntegrationCredentials; renewalError?: string } | null> {
    const reread = async () => {
      const credentials = await this.readCredentials(integrationId, account.accountId);
      return credentials ? { credentials } : null;
    };
    const persisted = await this.readCredentials(integrationId, account.accountId);
    if (!persisted) {
      this.unsavedRenewals.delete(key);
      return null;
    }
    let persistedJson = JSON.stringify(persisted);
    let stored = persisted;
    const unsaved = this.unsavedRenewals.get(key);
    if (unsaved?.replaces === persistedJson) {
      stored = unsaved.credentials;
      const saved = await this.saveRenewed(integrationId, account.accountId, stored, persistedJson);
      if (saved === 'superseded') {
        this.unsavedRenewals.delete(key);
        return await reread();
      }
      if (saved === 'saved') {
        this.unsavedRenewals.delete(key);
        persistedJson = JSON.stringify(stored);
      }
    } else if (unsaved) {
      this.unsavedRenewals.delete(key);
    }
    if (!this.expiresSoon(stored)) return { credentials: stored };

    const storedJson = JSON.stringify(stored);
    const failure = this.failedRenewals.get(key);
    if (failure?.credentials !== storedJson) {
      this.failedRenewals.delete(key);
    } else if (failure.error.type === 'rejected') {
      return { credentials: stored, renewalError: failure.error.message };
    }
    const renewed = await renew(integrationId, toIntegrationAccount(account, stored), this.now());
    if (!renewed.success) {
      log.warn('IntegrationAccountStore: credential renewal failed', {
        integrationId,
        accountId: account.accountId,
        error: renewed.error.type,
      });
      this.failedRenewals.set(key, { credentials: storedJson, error: renewed.error });
      return { credentials: stored, renewalError: renewed.error.message };
    }
    this.failedRenewals.delete(key);
    if (!renewed.data) return { credentials: stored };
    const saved = await this.saveRenewed(
      integrationId,
      account.accountId,
      renewed.data,
      persistedJson
    );
    if (saved === 'failed') {
      this.unsavedRenewals.set(key, { replaces: persistedJson, credentials: renewed.data });
      return { credentials: renewed.data };
    }
    this.unsavedRenewals.delete(key);
    if (saved === 'superseded') return await reread();
    return { credentials: renewed.data };
  }

  private renewerFor(
    integrationId: string,
    credentialSource: string | undefined
  ): CredentialRenewer | undefined {
    const renewer = credentialSource ? this.renewers.get(credentialSource) : undefined;
    if (renewer) return renewer;
    const auth = integrationPluginRegistry.get(integrationId)?.behavior.auth;
    if (!auth?.refreshCredentials) return undefined;
    const refresh = auth.refreshCredentials.bind(auth);
    return async (_integrationId, account, now) => {
      const refreshed = await refresh({ log }, account.credentials, now);
      if (refreshed.success) return refreshed;
      return err({
        type: refreshed.error.type === 'auth_failed' ? 'rejected' : 'unavailable',
        message: refreshed.error.message,
      });
    };
  }

  private expiresSoon(credentials: IntegrationCredentials): boolean {
    const expiresAt = credentialsExpireAt(credentials);
    return expiresAt !== undefined && expiresAt - this.now() <= CREDENTIAL_RENEWAL_SKEW_MS;
  }

  /** Writes `credentials` unless the stored credentials no longer match `replaces`. */
  private async saveRenewed(
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
      log.error('IntegrationAccountStore: renewed credentials were not saved', {
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

  /** Serialized with renewals of the same account. */
  async upsertAccount(integrationId: string, account: IntegrationAccountRecord) {
    return await this.renewals.runExclusive(`${integrationId}\u0000${account.accountId}`, () =>
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
