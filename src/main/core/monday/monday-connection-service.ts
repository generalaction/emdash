import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { ISSUE_PROVIDER_CAPABILITIES, type ConnectionStatus } from '@shared/issue-providers';

const MONDAY_API_URL = 'https://api.monday.com/v2';
const CREDENTIALS_KEY = 'emdash-monday-credentials';

export const MONDAY_API_ERROR_MESSAGES = {
  AUTH_FAILED: 'Monday.com authentication failed. Check your API token.',
  MISSING_PERMISSIONS: 'Monday.com token was accepted but is missing required permissions.',
  RATE_LIMITED: 'Monday.com API rate limit exceeded. Please try again shortly.',
  UNAVAILABLE: 'Monday.com API is temporarily unavailable. Please try again.',
} as const;

type MondayCredentials = {
  token: string;
  boardIds: string[];
  boardUrls: string[];
};

type SaveCredentialsInput = {
  token: string;
  boardUrls: string;
};

function normalizeStoredCredentials(raw: unknown): MondayCredentials | null {
  if (!raw || typeof raw !== 'object') return null;

  const candidate = raw as Partial<MondayCredentials>;
  if (typeof candidate.token !== 'string' || !candidate.token.trim()) {
    return null;
  }

  const boardIds = candidate.boardIds ?? [];
  const boardUrls = candidate.boardUrls ?? [];

  if (!Array.isArray(boardIds) || boardIds.some((id) => typeof id !== 'string')) {
    return null;
  }

  if (!Array.isArray(boardUrls) || boardUrls.some((url) => typeof url !== 'string')) {
    return null;
  }

  return {
    token: candidate.token,
    boardIds: [...new Set(boardIds)],
    boardUrls: [...new Set(boardUrls)],
  };
}

function toMondayApiErrorMessage(status: number, apiMessage?: string): string {
  if (apiMessage) return apiMessage;

  if (status === 401) return MONDAY_API_ERROR_MESSAGES.AUTH_FAILED;
  if (status === 403) return MONDAY_API_ERROR_MESSAGES.MISSING_PERMISSIONS;
  if (status === 429) return MONDAY_API_ERROR_MESSAGES.RATE_LIMITED;
  if (status >= 500) return MONDAY_API_ERROR_MESSAGES.UNAVAILABLE;

  return `Monday API error (${status})`;
}

export class MondayConnectionService {
  private cachedCredentials: MondayCredentials | null | undefined = undefined;

  async saveCredentials(
    input: SaveCredentialsInput
  ): Promise<{ success: boolean; workspaceName?: string; error?: string }> {
    const token = input.token.trim();
    if (!token) {
      return { success: false, error: 'Monday.com API token cannot be empty.' };
    }

    const boardScope = this.parseBoardUrls(input.boardUrls);
    if (boardScope === null) {
      return {
        success: false,
        error: `Could not parse board ID from one or more URLs. Expected format: https://<team>.monday.com/boards/<id>`,
      };
    }

    try {
      const me = await this.fetchMe(token);
      const credentials: MondayCredentials = { token, ...boardScope };
      await this.storeCredentials(credentials);
      telemetryService.capture('integration_connected', { provider: 'monday' });
      return { success: true, workspaceName: me.accountName ?? me.name };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to validate Monday.com token. Please try again.';
      return { success: false, error: message };
    }
  }

  async clearCredentials(): Promise<{ success: boolean; error?: string }> {
    try {
      await encryptedAppSecretsStore.deleteSecret(CREDENTIALS_KEY);
      this.cachedCredentials = null;
      telemetryService.capture('integration_disconnected', { provider: 'monday' });
      return { success: true };
    } catch (error) {
      log.error('Failed to clear Monday.com credentials:', error);
      return {
        success: false,
        error: 'Unable to remove Monday.com credentials from secure storage.',
      };
    }
  }

  async checkConnection(): Promise<ConnectionStatus> {
    try {
      const credentials = await this.getStoredCredentials();
      if (!credentials) {
        return { connected: false, capabilities: ISSUE_PROVIDER_CAPABILITIES.monday };
      }

      const me = await this.fetchMe(credentials.token);
      return {
        connected: true,
        displayName: me.accountName ?? me.name,
        capabilities: ISSUE_PROVIDER_CAPABILITIES.monday,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to verify Monday.com connection.';
      return { connected: false, error: message, capabilities: ISSUE_PROVIDER_CAPABILITIES.monday };
    }
  }

  async getStoredCredentials(): Promise<MondayCredentials | null> {
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
      log.error('Failed to read Monday.com credentials from secure storage:', error);
      return null;
    }
  }

  async query<T>(token: string, queryStr: string, variables?: Record<string, unknown>): Promise<T> {
    const response = await fetch(MONDAY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
      },
      body: JSON.stringify({ query: queryStr, variables }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const message = body?.errors?.[0]?.message ?? body?.error_message;
      throw new Error(toMondayApiErrorMessage(response.status, message));
    }

    const json = await response.json();
    if (json.errors?.length) {
      throw new Error(json.errors[0].message);
    }
    return json.data as T;
  }

  private parseBoardUrls(
    boardUrls: string
  ): Pick<MondayCredentials, 'boardIds' | 'boardUrls'> | null {
    const raw = boardUrls.trim();
    if (!raw) return { boardIds: [], boardUrls: [] };

    const urls = raw
      .split(/[,\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const ids = new Set<string>();
    const normalizedUrls = new Set<string>();

    for (const url of urls) {
      const match = url.match(/(https?:\/\/[^/]+)\/boards\/(\d+)/);
      if (!match) return null;
      ids.add(match[2]);
      normalizedUrls.add(`${match[1]}/boards/${match[2]}`);
    }

    return { boardIds: [...ids], boardUrls: [...normalizedUrls] };
  }

  private async fetchMe(
    token: string
  ): Promise<{ id: string; name: string; accountName?: string }> {
    const data = await this.query<{ me: { id: string; name: string; account: { name: string } } }>(
      token,
      'query { me { id name account { name } } }'
    );
    return { id: data.me.id, name: data.me.name, accountName: data.me.account?.name };
  }

  private async storeCredentials(credentials: MondayCredentials): Promise<void> {
    try {
      await encryptedAppSecretsStore.setSecret(CREDENTIALS_KEY, JSON.stringify(credentials));
      this.cachedCredentials = credentials;
    } catch (error) {
      log.error('Failed to store Monday.com credentials:', error);
      throw new Error('Unable to store Monday.com credentials securely.');
    }
  }
}

export const mondayConnectionService = new MondayConnectionService();
