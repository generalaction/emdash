import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { ISSUE_PROVIDER_CAPABILITIES, type ConnectionStatus } from '@shared/issue-providers';

const MONDAY_API_URL = 'https://api.monday.com/v2';
const CREDENTIALS_KEY = 'emdash-monday-credentials';

type MondayCredentials = {
  token: string;
  boardIds: string[];
};

type SaveCredentialsInput = {
  token: string;
  boardUrls: string;
};

export class MondayConnectionService {
  private cachedCredentials: MondayCredentials | null | undefined = undefined;

  async saveCredentials(
    input: SaveCredentialsInput
  ): Promise<{ success: boolean; workspaceName?: string; error?: string }> {
    const token = input.token.trim();
    if (!token) {
      return { success: false, error: 'Monday.com API token cannot be empty.' };
    }

    const boardIds = this.parseBoardUrls(input.boardUrls);
    if (boardIds === null) {
      return {
        success: false,
        error: `Could not parse board ID from one or more URLs. Expected format: https://<team>.monday.com/boards/<id>`,
      };
    }

    try {
      const me = await this.fetchMe(token);
      const credentials: MondayCredentials = { token, boardIds };
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
      return { success: false, error: 'Unable to remove Monday.com credentials from secure storage.' };
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
      this.cachedCredentials = JSON.parse(raw) as MondayCredentials;
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
      const message =
        body?.errors?.[0]?.message ?? body?.error_message ?? `Monday API error (${response.status})`;
      throw new Error(message);
    }

    const json = await response.json();
    if (json.errors?.length) {
      throw new Error(json.errors[0].message);
    }
    return json.data as T;
  }

  private parseBoardUrls(boardUrls: string): string[] | null {
    const raw = boardUrls.trim();
    if (!raw) return [];

    const urls = raw
      .split(/[,\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const ids: string[] = [];

    for (const url of urls) {
      const match = url.match(/monday\.com\/boards\/(\d+)/);
      if (!match) return null;
      ids.push(match[1]);
    }

    return ids;
  }

  private async fetchMe(token: string): Promise<{ id: string; name: string; accountName?: string }> {
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
