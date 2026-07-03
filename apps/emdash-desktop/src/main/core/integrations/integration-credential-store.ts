import type { IntegrationCredentials } from '@emdash/plugins/integrations';
import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';
import { KV } from '@main/db/kv';
import { log } from '@main/lib/logger';

type JiraKVSchema = { creds: { siteUrl?: string; email?: string } };
type InstanceKVSchema = { connection: { instanceUrl?: string } };
type PlaneKVSchema = { connection: { apiBaseUrl?: string; workspaceSlug?: string } };

const jiraKV = new KV<JiraKVSchema>('jira');
const gitlabKV = new KV<InstanceKVSchema>('gitlab');
const forgejoKV = new KV<InstanceKVSchema>('forgejo');
const planeKV = new KV<PlaneKVSchema>('plane');

const LEGACY_SECRET_KEYS = {
  linear: 'emdash-linear-token',
  jira: 'emdash-jira-token',
  gitlab: 'emdash-gitlab-token',
  forgejo: 'emdash-forgejo-token',
  plane: 'emdash-plane-token',
  plain: 'emdash-plain-token',
  featurebase: 'emdash-featurebase-token',
  asana: 'emdash-asana-token',
  monday: 'emdash-monday-credentials',
  trello: 'emdash-trello-credentials',
} as const;

/** Account id used by single-account integrations. */
export const DEFAULT_INTEGRATION_ACCOUNT_ID = 'default';

export type IntegrationAccountRecord = {
  accountId: string;
  displayName?: string;
  credentials: IntegrationCredentials;
};

/**
 * Stored value per integration. Holds every connected account so that
 * multi-account support only needs new callers, not a storage migration.
 */
type IntegrationCredentialRecord = {
  accounts: IntegrationAccountRecord[];
};

function integrationSecretKey(integrationId: string): string {
  return `integration:${integrationId}`;
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseRecord(raw: string): IntegrationCredentialRecord | null {
  const parsed = parseJson(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const candidate = parsed as { accounts?: unknown };
  if (Array.isArray(candidate.accounts)) {
    const accounts = candidate.accounts.filter(
      (account): account is IntegrationAccountRecord =>
        !!account &&
        typeof account === 'object' &&
        typeof (account as { accountId?: unknown }).accountId === 'string' &&
        !!(account as { credentials?: unknown }).credentials &&
        typeof (account as { credentials?: unknown }).credentials === 'object'
    );
    return { accounts };
  }

  // Flat credentials object written by an interim build of this branch;
  // wrap it as the default account.
  return {
    accounts: [
      {
        accountId: DEFAULT_INTEGRATION_ACCOUNT_ID,
        credentials: parsed as IntegrationCredentials,
      },
    ],
  };
}

export class IntegrationCredentialStore {
  private cache = new Map<string, IntegrationCredentialRecord | null>();

  /**
   * Resolve one account: by id when given, otherwise the default account,
   * falling back to the only stored account.
   */
  async getAccount(
    integrationId: string,
    accountId?: string
  ): Promise<IntegrationAccountRecord | null> {
    const record = await this.getRecord(integrationId);
    if (!record || record.accounts.length === 0) return null;

    if (accountId) {
      return record.accounts.find((account) => account.accountId === accountId) ?? null;
    }
    return (
      record.accounts.find((account) => account.accountId === DEFAULT_INTEGRATION_ACCOUNT_ID) ??
      record.accounts[0] ??
      null
    );
  }

  async get(integrationId: string, accountId?: string): Promise<IntegrationCredentials | null> {
    const account = await this.getAccount(integrationId, accountId);
    return account?.credentials ?? null;
  }

  async upsertAccount(integrationId: string, account: IntegrationAccountRecord): Promise<void> {
    const record = (await this.getRecord(integrationId)) ?? { accounts: [] };
    const accounts = [
      ...record.accounts.filter((existing) => existing.accountId !== account.accountId),
      account,
    ];
    await this.writeRecord(integrationId, { accounts });
  }

  /** Remove one account, or every account when no accountId is given. */
  async delete(integrationId: string, accountId?: string): Promise<void> {
    if (accountId) {
      const record = await this.getRecord(integrationId);
      const accounts = (record?.accounts ?? []).filter(
        (account) => account.accountId !== accountId
      );
      if (accounts.length > 0) {
        await this.writeRecord(integrationId, { accounts });
        return;
      }
    }
    await encryptedAppSecretsStore.deleteSecret(integrationSecretKey(integrationId));
    this.cache.set(integrationId, null);
  }

  async isConfigured(integrationId: string): Promise<boolean> {
    const record = await this.getRecord(integrationId);
    return !!record && record.accounts.length > 0;
  }

  private async getRecord(integrationId: string): Promise<IntegrationCredentialRecord | null> {
    if (this.cache.has(integrationId)) {
      return this.cache.get(integrationId) ?? null;
    }

    const stored = await this.readStored(integrationId);
    if (stored) {
      this.cache.set(integrationId, stored);
      return stored;
    }

    return this.migrateLegacy(integrationId);
  }

  private async writeRecord(
    integrationId: string,
    record: IntegrationCredentialRecord
  ): Promise<void> {
    await encryptedAppSecretsStore.setSecret(
      integrationSecretKey(integrationId),
      JSON.stringify(record)
    );
    this.cache.set(integrationId, record);
  }

  private async readStored(integrationId: string): Promise<IntegrationCredentialRecord | null> {
    try {
      const raw = await encryptedAppSecretsStore.getSecret(integrationSecretKey(integrationId));
      if (!raw) return null;
      return parseRecord(raw);
    } catch (error) {
      log.error('Failed to read integration credentials', { integrationId, error });
      return null;
    }
  }

  private async migrateLegacy(integrationId: string): Promise<IntegrationCredentialRecord | null> {
    try {
      const credentials = await this.readLegacyCredentials(integrationId);
      if (!credentials) {
        // No legacy data; safe to cache the miss.
        this.cache.set(integrationId, null);
        return null;
      }

      const record: IntegrationCredentialRecord = {
        accounts: [{ accountId: DEFAULT_INTEGRATION_ACCOUNT_ID, credentials }],
      };
      await this.writeRecord(integrationId, record);
      await this.clearLegacyCredentials(integrationId);
      return record;
    } catch (error) {
      // Do not cache: a transient failure must not mask credentials that a
      // later attempt could migrate successfully.
      log.warn('Failed to migrate legacy integration credentials', { integrationId, error });
      return null;
    }
  }

  private async readLegacyCredentials(
    integrationId: string
  ): Promise<IntegrationCredentials | null> {
    switch (integrationId) {
      case 'linear': {
        const apiKey = readString(
          await encryptedAppSecretsStore.getSecret(LEGACY_SECRET_KEYS.linear)
        );
        return apiKey ? { apiKey } : null;
      }
      case 'jira': {
        const [rawToken, creds] = await Promise.all([
          encryptedAppSecretsStore.getSecret(LEGACY_SECRET_KEYS.jira),
          jiraKV.get('creds'),
        ]);
        const apiToken = readString(rawToken);
        const siteUrl = readString(creds?.siteUrl);
        const email = readString(creds?.email);
        return apiToken && siteUrl && email ? { siteUrl, email, apiToken } : null;
      }
      case 'gitlab': {
        const [rawToken, connection] = await Promise.all([
          encryptedAppSecretsStore.getSecret(LEGACY_SECRET_KEYS.gitlab),
          gitlabKV.get('connection'),
        ]);
        const apiToken = readString(rawToken);
        const instanceUrl = readString(connection?.instanceUrl);
        return apiToken && instanceUrl ? { instanceUrl, apiToken } : null;
      }
      case 'forgejo': {
        const [rawToken, connection] = await Promise.all([
          encryptedAppSecretsStore.getSecret(LEGACY_SECRET_KEYS.forgejo),
          forgejoKV.get('connection'),
        ]);
        const apiToken = readString(rawToken);
        const instanceUrl = readString(connection?.instanceUrl);
        return apiToken && instanceUrl ? { instanceUrl, apiToken } : null;
      }
      case 'plane': {
        const [rawKey, connection] = await Promise.all([
          encryptedAppSecretsStore.getSecret(LEGACY_SECRET_KEYS.plane),
          planeKV.get('connection'),
        ]);
        const apiKey = readString(rawKey);
        const apiBaseUrl = readString(connection?.apiBaseUrl);
        const workspaceSlug = readString(connection?.workspaceSlug);
        return apiKey && apiBaseUrl && workspaceSlug ? { apiBaseUrl, workspaceSlug, apiKey } : null;
      }
      case 'plain': {
        const apiKey = readString(
          await encryptedAppSecretsStore.getSecret(LEGACY_SECRET_KEYS.plain)
        );
        return apiKey ? { apiKey } : null;
      }
      case 'featurebase': {
        const apiKey = readString(
          await encryptedAppSecretsStore.getSecret(LEGACY_SECRET_KEYS.featurebase)
        );
        return apiKey ? { apiKey } : null;
      }
      case 'asana': {
        const accessToken = readString(
          await encryptedAppSecretsStore.getSecret(LEGACY_SECRET_KEYS.asana)
        );
        return accessToken ? { accessToken } : null;
      }
      case 'monday': {
        const raw = await encryptedAppSecretsStore.getSecret(LEGACY_SECRET_KEYS.monday);
        const parsed = raw ? parseJson(raw) : null;
        if (!parsed || typeof parsed !== 'object') return null;
        const candidate = parsed as Record<string, unknown>;
        const apiToken = readString(candidate.token) ?? readString(candidate.apiToken);
        if (!apiToken) return null;
        return {
          apiToken,
          boardIds: [...new Set(readStringArray(candidate.boardIds))],
          boardUrls: [...new Set(readStringArray(candidate.boardUrls))],
        };
      }
      case 'trello': {
        const raw = await encryptedAppSecretsStore.getSecret(LEGACY_SECRET_KEYS.trello);
        const parsed = raw ? parseJson(raw) : null;
        if (!parsed || typeof parsed !== 'object') return null;
        const candidate = parsed as Record<string, unknown>;
        const apiKey = readString(candidate.apiKey);
        const apiToken = readString(candidate.token) ?? readString(candidate.apiToken);
        if (!apiKey || !apiToken) return null;
        return {
          apiKey,
          apiToken,
          boardIds: [...new Set(readStringArray(candidate.boardIds))],
        };
      }
      default:
        return null;
    }
  }

  private async clearLegacyCredentials(integrationId: string): Promise<void> {
    switch (integrationId) {
      case 'jira':
        await Promise.allSettled([
          encryptedAppSecretsStore.deleteSecret(LEGACY_SECRET_KEYS.jira),
          jiraKV.del('creds'),
        ]);
        return;
      case 'gitlab':
        await Promise.allSettled([
          encryptedAppSecretsStore.deleteSecret(LEGACY_SECRET_KEYS.gitlab),
          gitlabKV.del('connection'),
        ]);
        return;
      case 'forgejo':
        await Promise.allSettled([
          encryptedAppSecretsStore.deleteSecret(LEGACY_SECRET_KEYS.forgejo),
          forgejoKV.del('connection'),
        ]);
        return;
      case 'plane':
        await Promise.allSettled([
          encryptedAppSecretsStore.deleteSecret(LEGACY_SECRET_KEYS.plane),
          planeKV.del('connection'),
        ]);
        return;
      default: {
        const key = LEGACY_SECRET_KEYS[integrationId as keyof typeof LEGACY_SECRET_KEYS];
        if (key) await encryptedAppSecretsStore.deleteSecret(key).catch(() => undefined);
      }
    }
  }
}

export const integrationCredentialStore = new IntegrationCredentialStore();
