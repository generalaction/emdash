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
    { credentials: string; credentialSource?: string; error: CredentialRenewalError }
  >();
  /** Renewed credentials that failed to persist, valid while the stored JSON is `replaces`. */
  private readonly unsavedRenewals = new Map<
    string,
    { replaces: string; credentials: IntegrationCredentials }
  >();
  /** Stored credentials, as JSON, that the provider rejected and that renew on the next read. */
  private readonly rejectedCredentials = new Map<string, string>();
  /** The last rejected credentials renewed early, so each rejected token forces one renewal. */
  private readonly forcedRenewals = new Map<string, string>();

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
   * Forgets failed renewals of accounts connected with `credentialSource`, e.g.
   * when the session their renewer depends on changes, so they are retried.
   */
  forgetRenewalFailures(credentialSource: string): void {
    for (const [key, failure] of this.failedRenewals) {
      if (failure.credentialSource === credentialSource) this.failedRenewals.delete(key);
    }
  }

  /**
   * Reports that the provider rejected `rejected`, e.g. because another device
   * rotated a token they share. The next read renews those expiring
   * credentials once, even before they expire. Resolves whether reading the
   * account again may return other credentials.
   */
  async reportRejected(
    integrationId: string,
    accountId: string,
    rejected: IntegrationCredentials
  ): Promise<boolean> {
    const account = await this.accounts.getAccount(integrationId, accountId);
    if (!account || !this.renewerFor(integrationId, account.meta?.credentialSource)) return false;
    const schema = integrationPluginRegistry.get(integrationId)?.behavior.auth?.credentialsSchema;
    const parsed = schema?.safeParse(rejected);
    const stored = await this.readCredentials(integrationId, account.accountId);
    if (!parsed?.success || !stored) return false;
    const rejectedJson = JSON.stringify(parsed.data);
    // Credentials replaced since they were used need no renewal.
    if (JSON.stringify(stored) !== rejectedJson) return true;
    // Renewal cannot help credentials that do not expire, such as access tokens.
    if (credentialsExpireAt(stored) === undefined) return false;
    const key = `${integrationId}\u0000${account.accountId}`;
    if (this.forcedRenewals.get(key) === rejectedJson) return false;
    this.rejectedCredentials.set(key, rejectedJson);
    return true;
  }

  /**
   * Resolve one account: by id when given, otherwise the integration's
   * default account. Credentials whose `expiresAt` is near, or that the
   * provider rejected (see `reportRejected`), are renewed and persisted
   * first; renewals are serialized per account because rotating refresh
   * tokens are single-use, and use the account's current credential source.
   * A failed renewal returns the stored credentials with `renewalError`, so
   * the API call reports the authentication failure. Credentials whose
   * renewal was rejected are not renewed again until they change or
   * `forgetRenewalFailures` runs. Renewed credentials that fail to persist
   * are kept in memory and written again on the next read, because the
   * provider has already invalidated the stored refresh token. A renewal is
   * saved only while the stored credentials it replaces are unchanged, so a
   * disconnect or reconnect during the request wins.
   */
  async getAccount(
    integrationId: string,
    accountId?: string
  ): Promise<IntegrationAccountRecord | null> {
    await this.prepare(integrationId);
    const account = await this.accounts.getAccount(integrationId, accountId);
    if (!account) return null;

    const credentials = await this.readCredentials(integrationId, account.accountId);
    if (!credentials) return null;
    const key = `${integrationId}\u0000${account.accountId}`;
    if (
      !this.renewerFor(integrationId, account.meta?.credentialSource) ||
      (!this.unsavedRenewals.has(key) && !this.needsRenewal(key, credentials))
    ) {
      return toIntegrationAccount(account, credentials);
    }
    const resolved = await this.renewals.runExclusive(key, () =>
      this.renewExclusive(integrationId, account.accountId, key)
    );
    if (!resolved) return null;
    return {
      ...toIntegrationAccount(resolved.account, resolved.credentials),
      ...(resolved.renewalError ? { renewalError: resolved.renewalError } : {}),
    };
  }

  /** Rereads metadata and credentials under the account lock, since a reconnect may replace both. */
  private async renewExclusive(
    integrationId: string,
    accountId: string,
    key: string
  ): Promise<{
    account: ProviderAccount;
    credentials: IntegrationCredentials;
    renewalError?: string;
  } | null> {
    const account = await this.accounts.getAccount(integrationId, accountId);
    const persisted = account ? await this.readCredentials(integrationId, accountId) : null;
    if (!account || !persisted) {
      this.unsavedRenewals.delete(key);
      return null;
    }
    const reread = async () => {
      const credentials = await this.readCredentials(integrationId, accountId);
      return credentials ? { account, credentials } : null;
    };
    let persistedJson = JSON.stringify(persisted);
    let stored = persisted;
    const unsaved = this.unsavedRenewals.get(key);
    if (unsaved?.replaces === persistedJson) {
      stored = unsaved.credentials;
      const saved = await this.saveRenewed(integrationId, accountId, stored, persistedJson);
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
    const credentialSource = account.meta?.credentialSource;
    const renew = this.renewerFor(integrationId, credentialSource);
    if (!renew || !this.needsRenewal(key, stored)) return { account, credentials: stored };

    const storedJson = JSON.stringify(stored);
    if (this.rejectedCredentials.get(key) === storedJson) {
      this.rejectedCredentials.delete(key);
      this.forcedRenewals.set(key, storedJson);
    }
    const failure = this.failedRenewals.get(key);
    if (failure?.credentials !== storedJson) {
      this.failedRenewals.delete(key);
    } else if (failure.error.type === 'rejected') {
      return { account, credentials: stored, renewalError: failure.error.message };
    }
    const renewed = await renew(integrationId, toIntegrationAccount(account, stored), this.now());
    if (!renewed.success) {
      log.warn('IntegrationAccountStore: credential renewal failed', {
        integrationId,
        accountId,
        error: renewed.error.type,
      });
      this.failedRenewals.set(key, {
        credentials: storedJson,
        ...(credentialSource ? { credentialSource } : {}),
        error: renewed.error,
      });
      return { account, credentials: stored, renewalError: renewed.error.message };
    }
    this.failedRenewals.delete(key);
    if (!renewed.data) return { account, credentials: stored };
    const saved = await this.saveRenewed(integrationId, accountId, renewed.data, persistedJson);
    if (saved === 'failed') {
      this.unsavedRenewals.set(key, { replaces: persistedJson, credentials: renewed.data });
      return { account, credentials: renewed.data };
    }
    this.unsavedRenewals.delete(key);
    if (saved === 'superseded') return await reread();
    return { account, credentials: renewed.data };
  }

  /** Credentials renew when they expire soon or the provider rejected them. */
  private needsRenewal(key: string, credentials: IntegrationCredentials): boolean {
    return (
      this.expiresSoon(credentials) ||
      this.rejectedCredentials.get(key) === JSON.stringify(credentials)
    );
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
      return (await this.writeCredentials(integrationId, accountId, credentials))
        ? 'saved'
        : 'superseded';
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

  /**
   * Replaces only the secret; account metadata is untouched. Resolves false
   * when the account was removed, which disconnects run without this lock.
   */
  private async writeCredentials(
    integrationId: string,
    accountId: string,
    credentials: IntegrationCredentials
  ): Promise<boolean> {
    const schema = integrationPluginRegistry.get(integrationId)?.behavior.auth?.credentialsSchema;
    const parsed = schema?.safeParse(credentials);
    if (!parsed?.success) throw new Error(`Invalid ${integrationId} credentials`);
    return await this.accounts.updateSecret(integrationId, accountId, JSON.stringify(parsed.data));
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
