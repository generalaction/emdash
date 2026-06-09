import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { ISSUE_PROVIDER_CAPABILITIES, type ConnectionStatus } from '@shared/issue-providers';
import { AsanaClient, AsanaHttpError } from './asana-client';

export const NOT_CONFIGURED_ERROR = 'Asana is not configured. Connect Asana in settings.';

export type AsanaWorkspace = {
  gid: string;
  name: string;
};

type AsanaUserResponse = {
  data?: {
    gid?: string;
    name?: string;
    workspaces?: AsanaWorkspace[];
  };
};

export function toAsanaErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof AsanaHttpError) {
    if (error.status === 401) {
      return 'Asana authentication failed. Check your access token.';
    }
    if (error.status === 403) {
      return 'Asana token was accepted but is missing required permissions.';
    }
    if (error.status === 429) {
      return 'Asana API rate limit exceeded. Please try again shortly.';
    }
    if (error.status >= 500) {
      return 'Asana API is temporarily unavailable. Please try again.';
    }
    return error.message || fallback;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

export class AsanaConnectionService {
  private readonly ASANA_TOKEN_SECRET_KEY = 'emdash-asana-token';

  private cachedToken: string | null | undefined = undefined;
  private cachedWorkspaceGid: string | null | undefined = undefined;
  private client: AsanaClient | null = null;
  private clientToken: string | null = null;

  async saveToken(
    token: string
  ): Promise<{ success: boolean; workspaceName?: string; error?: string }> {
    const clean = token.trim();
    if (!clean) {
      return { success: false, error: 'Asana access token cannot be empty.' };
    }

    try {
      const client = this.getClientForToken(clean);
      const user = await this.fetchUser(client);
      await this.storeToken(clean);
      this.cachedWorkspaceGid = user.workspaces?.[0]?.gid ?? null;
      telemetryService.capture('integration_connected', { provider: 'asana' });

      return {
        success: true,
        workspaceName: user.workspaces?.[0]?.name ?? user.name,
      };
    } catch (error) {
      return {
        success: false,
        error: toAsanaErrorMessage(error, 'Failed to validate Asana access token.'),
      };
    }
  }

  async clearToken(): Promise<{ success: boolean; error?: string }> {
    try {
      await encryptedAppSecretsStore.deleteSecret(this.ASANA_TOKEN_SECRET_KEY);
      this.cachedToken = null;
      this.cachedWorkspaceGid = undefined;
      this.client = null;
      this.clientToken = null;
      telemetryService.capture('integration_disconnected', { provider: 'asana' });
      return { success: true };
    } catch (error) {
      log.error('Failed to clear Asana token:', error);
      return {
        success: false,
        error: 'Unable to remove Asana token from secure storage.',
      };
    }
  }

  async checkConnection(): Promise<ConnectionStatus> {
    try {
      const token = await this.getStoredToken();
      if (!token) {
        return {
          connected: false,
          capabilities: ISSUE_PROVIDER_CAPABILITIES.asana,
        };
      }

      const client = this.getClientForToken(token);
      const user = await this.fetchUser(client);
      const workspaceName = user.workspaces?.[0]?.name;
      const displayName = workspaceName ?? user.name;
      const displayDetail =
        workspaceName && user.name && workspaceName !== user.name ? user.name : undefined;

      return {
        connected: true,
        displayName,
        displayDetail,
        capabilities: ISSUE_PROVIDER_CAPABILITIES.asana,
      };
    } catch (error) {
      return {
        connected: false,
        error: toAsanaErrorMessage(error, 'Failed to verify Asana connection.'),
        capabilities: ISSUE_PROVIDER_CAPABILITIES.asana,
      };
    }
  }

  async isConfigured(): Promise<boolean> {
    return !!(await this.getStoredToken());
  }

  async getClient(): Promise<AsanaClient | null> {
    const token = await this.getStoredToken();
    if (!token) {
      return null;
    }
    return this.getClientForToken(token);
  }

  async getPrimaryWorkspaceGid(): Promise<string | null> {
    const client = await this.getClient();
    if (!client) return null;
    if (this.cachedWorkspaceGid !== undefined) return this.cachedWorkspaceGid;

    const user = await this.fetchUser(client);
    this.cachedWorkspaceGid = user.workspaces?.[0]?.gid ?? null;
    return this.cachedWorkspaceGid;
  }

  private async fetchUser(client: AsanaClient): Promise<{
    gid?: string;
    name?: string;
    workspaces?: AsanaWorkspace[];
  }> {
    const response = await client.get<AsanaUserResponse>('/users/me', {
      opt_fields: 'name,workspaces.gid,workspaces.name',
    });
    return response.data ?? {};
  }

  private getClientForToken(token: string): AsanaClient {
    if (!this.client || this.clientToken !== token) {
      this.client = new AsanaClient(token);
      this.clientToken = token;
      this.cachedWorkspaceGid = undefined;
    }
    return this.client;
  }

  private async storeToken(token: string): Promise<void> {
    try {
      await encryptedAppSecretsStore.setSecret(this.ASANA_TOKEN_SECRET_KEY, token);
      this.cachedToken = token;
    } catch (error) {
      log.error('Failed to store Asana token:', error);
      throw new Error('Unable to store Asana token securely.');
    }
  }

  private async getStoredToken(): Promise<string | null> {
    if (this.cachedToken) {
      return this.cachedToken;
    }

    try {
      this.cachedToken = await encryptedAppSecretsStore.getSecret(this.ASANA_TOKEN_SECRET_KEY);
      return this.cachedToken;
    } catch (error) {
      log.error('Failed to read Asana token from secure storage:', error);
      return null;
    }
  }
}

export const asanaConnectionService = new AsanaConnectionService();
