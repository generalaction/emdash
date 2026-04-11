import { LinearClient } from '@linear/sdk';
import keytar from 'keytar';
import { ISSUE_PROVIDER_CAPABILITIES, type ConnectionStatus } from '@shared/issue-providers';
import { log } from '@main/lib/logger';
import { capture } from '@main/lib/telemetry';

export class LinearConnectionService {
  private readonly SERVICE_NAME = 'emdash-linear';
  private readonly ACCOUNT_NAME = 'api-token';

  private cachedToken: string | null | undefined = undefined;
  private client: LinearClient | null = null;
  private clientToken: string | null = null;

  async saveToken(
    token: string
  ): Promise<{ success: boolean; workspaceName?: string; error?: string }> {
    try {
      const clean = token.trim();
      if (!clean) {
        return { success: false, error: 'Linear token cannot be empty.' };
      }

      const client = this.getClientForToken(clean);
      const viewer = await client.viewer;
      const org = await viewer.organization;

      await this.storeToken(clean);
      capture('integration_connected', { provider: 'linear' });

      return {
        success: true,
        workspaceName: org?.name ?? viewer.displayName ?? undefined,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to validate Linear token. Please try again.';
      return { success: false, error: message };
    }
  }

  async clearToken(): Promise<{ success: boolean; error?: string }> {
    try {
      await keytar.deletePassword(this.SERVICE_NAME, this.ACCOUNT_NAME);
      this.cachedToken = null;
      this.client = null;
      this.clientToken = null;
      capture('integration_disconnected', { provider: 'linear' });
      return { success: true };
    } catch (error) {
      log.error('Failed to clear Linear token:', error);
      return {
        success: false,
        error: 'Unable to remove Linear token from keychain.',
      };
    }
  }

  async checkConnection(): Promise<ConnectionStatus> {
    try {
      const token = await this.getStoredToken();
      if (!token) {
        return {
          connected: false,
          capabilities: ISSUE_PROVIDER_CAPABILITIES.linear,
        };
      }

      const client = this.getClientForToken(token);
      const viewer = await client.viewer;
      const org = await viewer.organization;

      return {
        connected: true,
        displayName: org?.name ?? viewer.displayName ?? undefined,
        capabilities: ISSUE_PROVIDER_CAPABILITIES.linear,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to verify Linear connection.';
      return {
        connected: false,
        error: message,
        capabilities: ISSUE_PROVIDER_CAPABILITIES.linear,
      };
    }
  }

  async getClient(): Promise<LinearClient | null> {
    const token = await this.getStoredToken();
    if (!token) {
      return null;
    }

    return this.getClientForToken(token);
  }

  private getClientForToken(token: string): LinearClient {
    if (!this.client || this.clientToken !== token) {
      this.client = new LinearClient({ apiKey: token });
      this.clientToken = token;
    }
    return this.client;
  }

  private async storeToken(token: string): Promise<void> {
    try {
      await keytar.setPassword(this.SERVICE_NAME, this.ACCOUNT_NAME, token);
      this.cachedToken = token;
    } catch (error) {
      log.error('Failed to store Linear token:', error);
      throw new Error('Unable to store Linear token securely.');
    }
  }

  private async getStoredToken(): Promise<string | null> {
    if (this.cachedToken !== undefined) {
      return this.cachedToken;
    }

    try {
      this.cachedToken = await keytar.getPassword(this.SERVICE_NAME, this.ACCOUNT_NAME);
      return this.cachedToken;
    } catch (error) {
      log.error('Failed to read Linear token from keychain:', error);
      return null;
    }
  }
}

export const linearConnectionService = new LinearConnectionService();
