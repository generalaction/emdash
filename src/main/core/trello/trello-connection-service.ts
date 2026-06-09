import { mapWithConcurrency } from '@main/core/issues/helpers/map-with-concurrency';
import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { ISSUE_PROVIDER_CAPABILITIES, type ConnectionStatus } from '@shared/issue-providers';

const TRELLO_API_BASE_URL = 'https://api.trello.com/1';
const CREDENTIALS_KEY = 'emdash-trello-credentials';
const MAX_SELECTED_TRELLO_BOARDS = 20;
const TRELLO_REQUEST_CONCURRENCY = 5;

export const TRELLO_API_ERROR_MESSAGES = {
  AUTH_FAILED: 'Trello authentication failed. Check your API key and token.',
  MISSING_PERMISSIONS: 'Trello credentials were accepted but are missing required permissions.',
  RATE_LIMITED: 'Trello API rate limit exceeded. Please try again shortly.',
  UNAVAILABLE: 'Trello API is temporarily unavailable. Please try again.',
} as const;

export type TrelloAuth = {
  apiKey: string;
  token: string;
};

type TrelloCredentials = TrelloAuth & {
  boardIds: string[];
};

type SaveCredentialsInput = {
  apiKey: string;
  token: string;
  boardUrls: string;
};

type TrelloMember = {
  id: string;
  fullName?: string;
  username?: string;
};

function normalizeStoredCredentials(raw: unknown): TrelloCredentials | null {
  if (!raw || typeof raw !== 'object') return null;

  const candidate = raw as Partial<TrelloCredentials>;
  if (typeof candidate.apiKey !== 'string' || !candidate.apiKey.trim()) {
    return null;
  }
  if (typeof candidate.token !== 'string' || !candidate.token.trim()) {
    return null;
  }

  const boardIds = candidate.boardIds ?? [];
  if (!Array.isArray(boardIds) || boardIds.some((id) => typeof id !== 'string')) {
    return null;
  }

  return {
    apiKey: candidate.apiKey,
    token: candidate.token,
    boardIds: [...new Set(boardIds)],
  };
}

function toTrelloApiErrorMessage(status: number, apiMessage?: string): string {
  if (status === 401) return TRELLO_API_ERROR_MESSAGES.AUTH_FAILED;
  if (status === 403) return TRELLO_API_ERROR_MESSAGES.MISSING_PERMISSIONS;
  if (status === 429) return TRELLO_API_ERROR_MESSAGES.RATE_LIMITED;
  if (status >= 500) return TRELLO_API_ERROR_MESSAGES.UNAVAILABLE;

  return apiMessage || `Trello API error (${status})`;
}

export class TrelloConnectionService {
  private cachedCredentials: TrelloCredentials | null | undefined = undefined;

  async saveCredentials(
    input: SaveCredentialsInput
  ): Promise<{ success: boolean; displayName?: string; error?: string }> {
    const apiKey = input.apiKey.trim();
    const token = input.token.trim();
    if (!apiKey || !token) {
      return { success: false, error: 'Trello API key and token cannot be empty.' };
    }

    const boardShortLinks = this.parseBoardUrls(input.boardUrls);
    if (boardShortLinks === null) {
      return {
        success: false,
        error: `Could not parse board ID from one or more URLs. Expected format: https://trello.com/b/<id>`,
      };
    }
    if (boardShortLinks.length > MAX_SELECTED_TRELLO_BOARDS) {
      return {
        success: false,
        error: `Trello board scope is limited to ${MAX_SELECTED_TRELLO_BOARDS} boards. Remove some board URLs and try again.`,
      };
    }

    try {
      const auth: TrelloAuth = { apiKey, token };
      const me = await this.fetchMe(auth);
      const boardIds = await this.resolveBoardIds(auth, boardShortLinks);
      const credentials: TrelloCredentials = { apiKey, token, boardIds };
      await this.storeCredentials(credentials);
      telemetryService.capture('integration_connected', { provider: 'trello' });
      return { success: true, displayName: me.fullName ?? me.username };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to validate Trello credentials. Please try again.';
      return { success: false, error: message };
    }
  }

  async clearCredentials(): Promise<{ success: boolean; error?: string }> {
    try {
      await encryptedAppSecretsStore.deleteSecret(CREDENTIALS_KEY);
      this.cachedCredentials = null;
      telemetryService.capture('integration_disconnected', { provider: 'trello' });
      return { success: true };
    } catch (error) {
      log.error('Failed to clear Trello credentials:', error);
      return {
        success: false,
        error: 'Unable to remove Trello credentials from secure storage.',
      };
    }
  }

  async checkConnection(): Promise<ConnectionStatus> {
    try {
      const credentials = await this.getStoredCredentials();
      if (!credentials) {
        return { connected: false, capabilities: ISSUE_PROVIDER_CAPABILITIES.trello };
      }

      const me = await this.fetchMe(credentials);
      const displayName = me.fullName ?? me.username;
      const displayDetail =
        me.fullName && me.username && me.fullName !== me.username ? `@${me.username}` : undefined;

      return {
        connected: true,
        displayName,
        displayDetail,
        capabilities: ISSUE_PROVIDER_CAPABILITIES.trello,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to verify Trello connection.';
      return { connected: false, error: message, capabilities: ISSUE_PROVIDER_CAPABILITIES.trello };
    }
  }

  async getStoredCredentials(): Promise<TrelloCredentials | null> {
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
      log.error('Failed to read Trello credentials from secure storage:', error);
      return null;
    }
  }

  async request<T>(auth: TrelloAuth, path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${TRELLO_API_BASE_URL}${path}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      url.searchParams.set(key, value);
    }
    url.searchParams.set('key', auth.apiKey);
    url.searchParams.set('token', auth.token);

    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(toTrelloApiErrorMessage(response.status, body?.trim().slice(0, 200)));
    }

    return (await response.json()) as T;
  }

  private parseBoardUrls(boardUrls: string): string[] | null {
    const raw = boardUrls.trim();
    if (!raw) return [];

    const urls = raw
      .split(/[,\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const shortLinks = new Set<string>();

    for (const url of urls) {
      const match = url.match(/trello\.com\/b\/([a-zA-Z0-9]+)/);
      if (!match) return null;
      shortLinks.add(match[1]);
    }

    return [...shortLinks];
  }

  private async resolveBoardIds(auth: TrelloAuth, shortLinks: string[]): Promise<string[]> {
    const boards = await mapWithConcurrency(
      shortLinks,
      TRELLO_REQUEST_CONCURRENCY,
      async (shortLink) => {
        try {
          return await this.request<{ id: string }>(auth, `/boards/${shortLink}`, { fields: 'id' });
        } catch {
          throw new Error(
            `Could not access Trello board "${shortLink}". Check the board URL and your permissions.`
          );
        }
      }
    );
    return [...new Set(boards.map((board) => board.id))];
  }

  private async fetchMe(auth: TrelloAuth): Promise<TrelloMember> {
    return this.request<TrelloMember>(auth, '/members/me', { fields: 'fullName,username' });
  }

  private async storeCredentials(credentials: TrelloCredentials): Promise<void> {
    try {
      await encryptedAppSecretsStore.setSecret(CREDENTIALS_KEY, JSON.stringify(credentials));
      this.cachedCredentials = credentials;
    } catch (error) {
      log.error('Failed to store Trello credentials:', error);
      throw new Error('Unable to store Trello credentials securely.');
    }
  }
}

export const trelloConnectionService = new TrelloConnectionService();
