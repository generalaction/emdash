import type { IntegrationCredentials } from '@emdash/plugins/integrations';
import { eq } from 'drizzle-orm';
import type { AppDb } from '@core/services/app-db/node/db';
import { kv } from '@core/services/app-db/node/schema';
import type {
  ProviderAccount,
  ProviderAccountStore,
} from '@core/services/provider-accounts/api/provider-account-store';
import type { LegacyAccountImports } from '@core/services/provider-accounts/node/migrations/legacy-account-imports';

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

/** Released single-account integrations used this ID; existing project pins retain it. */
export const DEFAULT_INTEGRATION_ACCOUNT_ID = 'default';

export type LegacySecretStore = {
  getSecret(key: string): Promise<string | null>;
  deleteSecret(key: string): Promise<void>;
};

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** Import completion is durable and independent of retryable source cleanup. */
export class LegacyIntegrationAccountsMigration {
  constructor(
    private readonly db: AppDb,
    private readonly accounts: ProviderAccountStore,
    private readonly secrets: LegacySecretStore,
    private readonly imports: LegacyAccountImports
  ) {}

  async run(integrationId: string): Promise<void> {
    if (!(integrationId in LEGACY_SECRET_KEYS)) return;
    await this.imports.run(
      `integration-account-import:${integrationId}`,
      async (store) => {
        if (await this.accounts.isConfigured(integrationId)) return 'cleanup';
        const credentials = await this.readLegacyCredentials(integrationId);
        if (!credentials) return 'complete';
        await store.upsertAccount({
          providerId: integrationId,
          accountId: DEFAULT_INTEGRATION_ACCOUNT_ID,
          secret: JSON.stringify(credentials),
          meta: {},
        });
        return 'cleanup';
      },
      () => this.clearLegacyCredentials(integrationId)
    );
  }

  private async readLegacyConfig(key: string): Promise<Record<string, unknown> | null> {
    const row = this.db.select().from(kv).where(eq(kv.key, key)).get();
    // Migration reads must distinguish absence from failed I/O / malformed data.
    return row ? JSON.parse(row.value) : null;
  }

  private async deleteLegacyConfig(key: string): Promise<void> {
    this.db.delete(kv).where(eq(kv.key, key)).run();
  }

  private async readLegacyCredentials(
    integrationId: string
  ): Promise<IntegrationCredentials | null> {
    switch (integrationId) {
      case 'linear': {
        const apiKey = readString(await this.secrets.getSecret(LEGACY_SECRET_KEYS.linear));
        return apiKey ? { apiKey } : null;
      }
      case 'jira': {
        const [rawToken, creds] = await Promise.all([
          this.secrets.getSecret(LEGACY_SECRET_KEYS.jira),
          this.readLegacyConfig('jira:creds'),
        ]);
        const apiToken = readString(rawToken);
        const siteUrl = readString(creds?.siteUrl);
        const email = readString(creds?.email);
        return apiToken && siteUrl && email ? { siteUrl, email, apiToken } : null;
      }
      case 'gitlab': {
        const [rawToken, connection] = await Promise.all([
          this.secrets.getSecret(LEGACY_SECRET_KEYS.gitlab),
          this.readLegacyConfig('gitlab:connection'),
        ]);
        const apiToken = readString(rawToken);
        const instanceUrl = readString(connection?.instanceUrl);
        return apiToken && instanceUrl ? { instanceUrl, apiToken } : null;
      }
      case 'forgejo': {
        const [rawToken, connection] = await Promise.all([
          this.secrets.getSecret(LEGACY_SECRET_KEYS.forgejo),
          this.readLegacyConfig('forgejo:connection'),
        ]);
        const apiToken = readString(rawToken);
        const instanceUrl = readString(connection?.instanceUrl);
        return apiToken && instanceUrl ? { instanceUrl, apiToken } : null;
      }
      case 'plane': {
        const [rawKey, connection] = await Promise.all([
          this.secrets.getSecret(LEGACY_SECRET_KEYS.plane),
          this.readLegacyConfig('plane:connection'),
        ]);
        const apiKey = readString(rawKey);
        const apiBaseUrl = readString(connection?.apiBaseUrl);
        const workspaceSlug = readString(connection?.workspaceSlug);
        return apiKey && apiBaseUrl && workspaceSlug ? { apiBaseUrl, workspaceSlug, apiKey } : null;
      }
      case 'plain': {
        const apiKey = readString(await this.secrets.getSecret(LEGACY_SECRET_KEYS.plain));
        return apiKey ? { apiKey } : null;
      }
      case 'featurebase': {
        const apiKey = readString(await this.secrets.getSecret(LEGACY_SECRET_KEYS.featurebase));
        return apiKey ? { apiKey } : null;
      }
      case 'asana': {
        const accessToken = readString(await this.secrets.getSecret(LEGACY_SECRET_KEYS.asana));
        return accessToken ? { accessToken } : null;
      }
      case 'monday': {
        const raw = await this.secrets.getSecret(LEGACY_SECRET_KEYS.monday);
        const parsed = raw ? parseJson(raw) : null;
        if (!parsed || typeof parsed !== 'object') return null;
        const candidate = parsed as Record<string, unknown>;
        const apiToken = readString(candidate.token) ?? readString(candidate.apiToken);
        if (!apiToken) return null;
        return { apiToken };
      }
      case 'trello': {
        const raw = await this.secrets.getSecret(LEGACY_SECRET_KEYS.trello);
        const parsed = raw ? parseJson(raw) : null;
        if (!parsed || typeof parsed !== 'object') return null;
        const candidate = parsed as Record<string, unknown>;
        const apiKey = readString(candidate.apiKey);
        const apiToken = readString(candidate.token) ?? readString(candidate.apiToken);
        if (!apiKey || !apiToken) return null;
        return {
          apiKey,
          apiToken,
        };
      }
      default:
        return null;
    }
  }

  private async clearLegacyCredentials(integrationId: string): Promise<void> {
    switch (integrationId) {
      case 'jira':
        await Promise.all([
          this.secrets.deleteSecret(LEGACY_SECRET_KEYS.jira),
          this.deleteLegacyConfig('jira:creds'),
        ]);
        return;
      case 'gitlab':
        await Promise.all([
          this.secrets.deleteSecret(LEGACY_SECRET_KEYS.gitlab),
          this.deleteLegacyConfig('gitlab:connection'),
        ]);
        return;
      case 'forgejo':
        await Promise.all([
          this.secrets.deleteSecret(LEGACY_SECRET_KEYS.forgejo),
          this.deleteLegacyConfig('forgejo:connection'),
        ]);
        return;
      case 'plane':
        await Promise.all([
          this.secrets.deleteSecret(LEGACY_SECRET_KEYS.plane),
          this.deleteLegacyConfig('plane:connection'),
        ]);
        return;
      default: {
        const key = LEGACY_SECRET_KEYS[integrationId as keyof typeof LEGACY_SECRET_KEYS];
        if (key) await this.secrets.deleteSecret(key);
      }
    }
  }
}

/** Adopt a released single-account row only after proving it is the same identity. */
export async function findMatchingLegacyAccount(
  integrationId: string,
  accounts: ProviderAccountStore,
  readCredentials: (accountId: string) => Promise<IntegrationCredentials | null>,
  matches: (credentials: IntegrationCredentials) => Promise<boolean>
): Promise<ProviderAccount | null> {
  const account = await accounts.getAccount(integrationId, DEFAULT_INTEGRATION_ACCOUNT_ID);
  if (!account || account.meta?.providerAccountId) return null;
  const credentials = await readCredentials(account.accountId);
  // Verification can outlive removal. Never adopt a row that disappeared while it ran.
  return credentials && (await matches(credentials))
    ? accounts.getAccount(integrationId, account.accountId)
    : null;
}
