import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';
import { log } from '@main/lib/logger';
import { ISSUE_PROVIDER_CAPABILITIES, type ConnectionStatus } from '@shared/issue-providers';
import { FeaturebaseClient, FeaturebaseHttpError } from './featurebase-client';

export const NOT_CONFIGURED_ERROR =
  'Featurebase is not configured. Connect Featurebase in settings.';

export function toFeaturebaseErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof FeaturebaseHttpError) {
    if (error.status === 401) {
      return 'Featurebase authentication failed. Check your API key.';
    }
    if (error.status === 403) {
      return 'Featurebase API key was accepted but is missing required permissions.';
    }
    if (error.status === 429) {
      return 'Featurebase API rate limit exceeded. Please try again shortly.';
    }
    if (error.status >= 500) {
      return 'Featurebase API is temporarily unavailable. Please try again.';
    }
    return error.message || fallback;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

function isNotConfigured(error: unknown): boolean {
  return error instanceof Error && error.message === NOT_CONFIGURED_ERROR;
}

export class FeaturebaseConnectionService {
  private readonly FEATUREBASE_TOKEN_SECRET_KEY = 'emdash-featurebase-token';

  private cachedToken: string | null | undefined = undefined;
  private client: FeaturebaseClient | null = null;
  private clientToken: string | null = null;

  async saveToken(token: string): Promise<{ success: boolean; error?: string }> {
    const clean = token.trim();
    if (!clean) {
      return { success: false, error: 'Featurebase API key cannot be empty.' };
    }

    try {
      const client = this.getClientForToken(clean);
      await this.validateToken(client);
      await this.storeToken(clean);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: toFeaturebaseErrorMessage(error, 'Failed to validate Featurebase API key.'),
      };
    }
  }

  async clearToken(): Promise<{ success: boolean; error?: string }> {
    try {
      await encryptedAppSecretsStore.deleteSecret(this.FEATUREBASE_TOKEN_SECRET_KEY);
      this.cachedToken = null;
      this.client = null;
      this.clientToken = null;
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: toFeaturebaseErrorMessage(error, 'Failed to clear Featurebase API key.'),
      };
    }
  }

  async checkConnection(): Promise<ConnectionStatus> {
    try {
      const token = await this.getStoredToken();
      if (!token) {
        return {
          connected: false,
          capabilities: ISSUE_PROVIDER_CAPABILITIES.featurebase,
        };
      }

      const client = this.getClientForToken(token);
      await this.validateToken(client);

      return {
        connected: true,
        capabilities: ISSUE_PROVIDER_CAPABILITIES.featurebase,
      };
    } catch (error) {
      if (isNotConfigured(error)) {
        return {
          connected: false,
          capabilities: ISSUE_PROVIDER_CAPABILITIES.featurebase,
        };
      }

      return {
        connected: false,
        error: toFeaturebaseErrorMessage(error, 'Failed to verify Featurebase connection.'),
        capabilities: ISSUE_PROVIDER_CAPABILITIES.featurebase,
      };
    }
  }

  async getClient(): Promise<FeaturebaseClient | null> {
    const token = await this.getStoredToken();
    if (!token) {
      return null;
    }

    return this.getClientForToken(token);
  }

  private getClientForToken(token: string): FeaturebaseClient {
    if (!this.client || this.clientToken !== token) {
      this.client = new FeaturebaseClient(token);
      this.clientToken = token;
    }
    return this.client;
  }

  private async storeToken(token: string): Promise<void> {
    await encryptedAppSecretsStore.setSecret(this.FEATUREBASE_TOKEN_SECRET_KEY, token);
    this.cachedToken = token;
  }

  private async getStoredToken(): Promise<string | null> {
    if (this.cachedToken) {
      return this.cachedToken;
    }

    try {
      this.cachedToken = await encryptedAppSecretsStore.getSecret(
        this.FEATUREBASE_TOKEN_SECRET_KEY
      );
      return this.cachedToken;
    } catch (error) {
      log.error('Failed to read Featurebase token from secure storage:', error);
      return null;
    }
  }

  private async validateToken(client: FeaturebaseClient): Promise<void> {
    await client.get('/v2/posts', { limit: 1 });
  }
}

export const featurebaseConnectionService = new FeaturebaseConnectionService();
