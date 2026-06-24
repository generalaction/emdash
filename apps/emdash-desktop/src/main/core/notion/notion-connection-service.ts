import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { ISSUE_PROVIDER_CAPABILITIES, type ConnectionStatus } from '@shared/issue-providers';

const NOTION_API_BASE_URL = 'https://api.notion.com/v1';
const NOTION_VERSION = '2026-03-11';
const CREDENTIALS_KEY = 'emdash-notion-credentials';
const MAX_SELECTED_DATABASES = 50;

export const NOTION_API_ERROR_MESSAGES = {
  AUTH_FAILED: 'Notion authentication failed. Check your access token.',
  MISSING_PERMISSIONS:
    'Notion token was accepted but is missing access to the selected pages or databases.',
  RATE_LIMITED: 'Notion API rate limit exceeded. Please try again shortly.',
  UNAVAILABLE: 'Notion API is temporarily unavailable. Please try again.',
} as const;

export type NotionPageScope =
  | { type: 'all-shared' }
  | { type: 'data-sources'; dataSourceIds: string[]; sourceUrls: string[] };

export type NotionCredentials = {
  token: string;
  scope: NotionPageScope;
};

type SaveCredentialsInput = {
  token: string;
  databaseUrls: string;
};

export type NotionConfiguration = {
  hasCredentials: boolean;
  databaseUrls: string;
};

type NotionUser = {
  id: string;
  name?: string | null;
  bot?: { owner?: { type?: string; workspace?: boolean }; workspace_name?: string | null };
};

type StoredNotionCredentials = {
  token?: unknown;
  scope?: unknown;
  databaseIds?: unknown;
  databaseUrls?: unknown;
};

function uniqueStrings(values: unknown): string[] | null {
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
    return null;
  }
  return [...new Set(values)];
}

function normalizeStoredScope(candidate: StoredNotionCredentials): NotionPageScope | null {
  if (candidate.scope && typeof candidate.scope === 'object') {
    const scope = candidate.scope as Partial<NotionPageScope>;
    if (scope.type === 'all-shared') {
      return { type: 'all-shared' };
    }
    if (scope.type === 'data-sources') {
      const dataSourceIds = uniqueStrings(scope.dataSourceIds);
      const sourceUrls = uniqueStrings(scope.sourceUrls);
      if (!dataSourceIds || !sourceUrls) return null;
      return dataSourceIds.length
        ? { type: 'data-sources', dataSourceIds, sourceUrls }
        : { type: 'all-shared' };
    }
    return null;
  }

  const legacyDatabaseIds = uniqueStrings(candidate.databaseIds ?? []);
  const legacyDatabaseUrls = uniqueStrings(candidate.databaseUrls ?? []);
  if (!legacyDatabaseIds || !legacyDatabaseUrls) return null;
  return legacyDatabaseIds.length
    ? {
        type: 'data-sources',
        dataSourceIds: legacyDatabaseIds,
        sourceUrls: legacyDatabaseUrls,
      }
    : { type: 'all-shared' };
}

function normalizeStoredCredentials(raw: unknown): NotionCredentials | null {
  if (!raw || typeof raw !== 'object') return null;

  const candidate = raw as StoredNotionCredentials;
  if (typeof candidate.token !== 'string' || !candidate.token.trim()) {
    return null;
  }

  const scope = normalizeStoredScope(candidate);
  if (!scope) return null;

  return {
    token: candidate.token,
    scope,
  };
}

function normalizeNotionApiMessage(message: string): string {
  if (/Could not find (?:database|page|data source) with ID:/i.test(message)) {
    const integrationMatch = message.match(/integration "([^"]+)"/i);
    const integrationName = integrationMatch?.[1] ?? 'your Notion integration';
    return `Notion cannot access the configured data source. Share the page or database with ${integrationName}, or update the scope URLs in Emdash settings.`;
  }

  if (/Make sure the relevant pages and databases are shared/i.test(message)) {
    const integrationMatch = message.match(/integration "([^"]+)"/i);
    const integrationName = integrationMatch?.[1] ?? 'your Notion integration';
    return `Share the relevant pages and databases with ${integrationName}, or update the scope URLs in Emdash settings.`;
  }

  return message;
}

function toNotionApiErrorMessage(status: number, apiMessage?: string): string {
  if (apiMessage) return normalizeNotionApiMessage(apiMessage);

  if (status === 401) return NOTION_API_ERROR_MESSAGES.AUTH_FAILED;
  if (status === 403) return NOTION_API_ERROR_MESSAGES.MISSING_PERMISSIONS;
  if (status === 429) return NOTION_API_ERROR_MESSAGES.RATE_LIMITED;
  if (status >= 500) return NOTION_API_ERROR_MESSAGES.UNAVAILABLE;

  return `Notion API error (${status})`;
}

function normalizeNotionId(value: string): string | null {
  const compact = value.replace(/-/g, '').trim();
  if (!/^[a-fA-F0-9]{32}$/.test(compact)) return null;
  return compact.toLowerCase();
}

function isNotionUrlHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === 'notion.so' ||
    normalized.endsWith('.notion.so') ||
    normalized === 'notion.com' ||
    normalized.endsWith('.notion.com') ||
    normalized === 'notion.site' ||
    normalized.endsWith('.notion.site')
  );
}

function parseDatabaseIdFromUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (!isNotionUrlHostname(url.hostname)) {
      return null;
    }

    const candidates = [
      ...url.pathname.split('/'),
      ...url.searchParams.values(),
      url.hash.replace(/^#/, ''),
    ];

    for (const candidate of candidates) {
      const match = candidate.match(/[a-fA-F0-9]{32}/);
      if (!match) continue;
      const id = normalizeNotionId(match[0]);
      if (id) return id;
    }

    return null;
  } catch {
    return normalizeNotionId(rawUrl);
  }
}

export class NotionConnectionService {
  private cachedCredentials: NotionCredentials | null | undefined = undefined;

  async saveCredentials(
    input: SaveCredentialsInput
  ): Promise<{ success: boolean; displayName?: string; error?: string }> {
    const existingCredentials = await this.getStoredCredentials();
    const token = input.token.trim() || existingCredentials?.token || '';
    if (!token) {
      return { success: false, error: 'Access token cannot be empty.' };
    }

    const scope = this.parseDatabaseUrls(input.databaseUrls);
    if (scope === null) {
      return {
        success: false,
        error:
          'Could not parse Notion ID from one or more URLs. Paste Notion page, database, or data source URLs or 32-character IDs.',
      };
    }
    if (scope.type === 'data-sources' && scope.dataSourceIds.length > MAX_SELECTED_DATABASES) {
      return {
        success: false,
        error: `Notion scope is limited to ${MAX_SELECTED_DATABASES} data sources. Remove some URLs and try again.`,
      };
    }

    try {
      const user = await this.fetchMe(token);
      const credentials: NotionCredentials = { token, scope };
      await this.storeCredentials(credentials);
      telemetryService.capture('integration_connected', { provider: 'notion' });
      return { success: true, displayName: user.bot?.workspace_name ?? user.name ?? 'Notion' };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to validate Notion token. Please try again.';
      return { success: false, error: message };
    }
  }

  async getConfiguration(): Promise<NotionConfiguration> {
    const credentials = await this.getStoredCredentials();
    if (!credentials) {
      return { hasCredentials: false, databaseUrls: '' };
    }

    return {
      hasCredentials: true,
      databaseUrls:
        credentials.scope.type === 'data-sources' ? credentials.scope.sourceUrls.join('\n') : '',
    };
  }

  async clearCredentials(): Promise<{ success: boolean; error?: string }> {
    try {
      await encryptedAppSecretsStore.deleteSecret(CREDENTIALS_KEY);
      this.cachedCredentials = null;
      telemetryService.capture('integration_disconnected', { provider: 'notion' });
      return { success: true };
    } catch (error) {
      log.error('Failed to clear Notion credentials:', error);
      return {
        success: false,
        error: 'Unable to remove Notion credentials from secure storage.',
      };
    }
  }

  async checkConnection(): Promise<ConnectionStatus> {
    try {
      const credentials = await this.getStoredCredentials();
      if (!credentials) {
        return { connected: false, capabilities: ISSUE_PROVIDER_CAPABILITIES.notion };
      }

      const user = await this.fetchMe(credentials.token);
      return {
        connected: true,
        displayName: user.bot?.workspace_name ?? user.name ?? 'Notion',
        displayDetail: user.bot?.workspace_name && user.name ? user.name : undefined,
        capabilities: ISSUE_PROVIDER_CAPABILITIES.notion,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to verify Notion connection.';
      return { connected: false, error: message, capabilities: ISSUE_PROVIDER_CAPABILITIES.notion };
    }
  }

  async isConfigured(): Promise<boolean> {
    return !!(await this.getStoredCredentials());
  }

  async getStoredCredentials(): Promise<NotionCredentials | null> {
    if (this.cachedCredentials !== undefined) {
      return this.cachedCredentials;
    }

    try {
      const raw = await encryptedAppSecretsStore.getSecret(CREDENTIALS_KEY);
      if (!raw) {
        this.cachedCredentials = null;
        return null;
      }
      this.cachedCredentials = normalizeStoredCredentials(JSON.parse(raw));
      return this.cachedCredentials;
    } catch (error) {
      log.error('Failed to read Notion credentials from secure storage:', error);
      return null;
    }
  }

  async request<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    headers.set('Content-Type', 'application/json');
    headers.set('Notion-Version', NOTION_VERSION);
    headers.set('Authorization', `Bearer ${token}`);

    const response = await fetch(`${NOTION_API_BASE_URL}${path}`, {
      ...init,
      headers,
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(toNotionApiErrorMessage(response.status, body?.message));
    }

    return (await response.json()) as T;
  }

  private parseDatabaseUrls(databaseUrls: string): NotionPageScope | null {
    const raw = databaseUrls.trim();
    if (!raw) return { type: 'all-shared' };

    const values = raw
      .split(/[,\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const dataSourceIds = new Set<string>();
    const sourceUrls = new Set<string>();

    for (const value of values) {
      const id = parseDatabaseIdFromUrl(value);
      if (!id) return null;
      dataSourceIds.add(id);
      sourceUrls.add(value);
    }

    return {
      type: 'data-sources',
      dataSourceIds: [...dataSourceIds],
      sourceUrls: [...sourceUrls],
    };
  }

  private async fetchMe(token: string): Promise<NotionUser> {
    return this.request<NotionUser>(token, '/users/me');
  }

  private async storeCredentials(credentials: NotionCredentials): Promise<void> {
    try {
      await encryptedAppSecretsStore.setSecret(CREDENTIALS_KEY, JSON.stringify(credentials));
      this.cachedCredentials = credentials;
    } catch (error) {
      log.error('Failed to store Notion credentials:', error);
      throw new Error('Unable to save Notion credentials securely.');
    }
  }
}

export const notionConnectionService = new NotionConnectionService();
