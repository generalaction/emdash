import {
  AuthenticationError,
  ForbiddenError,
  PlainClient,
  PlainError,
  RateLimitError,
} from '@team-plain/graphql';
import { ISSUE_PROVIDER_CAPABILITIES, type ConnectionStatus } from '@shared/issue-providers';
import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';
import { log } from '@main/lib/logger';

const NOT_CONFIGURED_ERROR = 'Plain is not configured. Connect Plain in settings.';

export function toPlainErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof AuthenticationError) {
    return error.message || 'Plain authentication failed. Check your API key.';
  }
  if (error instanceof ForbiddenError) {
    return (
      error.message ||
      'Plain API key was accepted but is missing required permissions. Create a key with thread read permissions.'
    );
  }
  if (error instanceof RateLimitError) {
    return 'Plain API rate limit exceeded. Please try again shortly.';
  }
  if (error instanceof PlainError && error.message) {
    return error.message;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

function isNotConfigured(error: unknown): boolean {
  return error instanceof Error && error.message === NOT_CONFIGURED_ERROR;
}

export class PlainConnectionService {
  private readonly PLAIN_TOKEN_SECRET_KEY = 'emdash-plain-token';

  private cachedToken: string | null | undefined = undefined;
  private client: PlainClient | null = null;
  private clientToken: string | null = null;

  async saveToken(token: string): Promise<{ success: boolean; error?: string }> {
    const clean = token.trim();
    if (!clean) {
      return { success: false, error: 'Plain API key cannot be empty.' };
    }

    try {
      const client = this.getClientForToken(clean);
      await this.validateToken(client);
      await this.storeToken(clean);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: toPlainErrorMessage(error, 'Failed to validate Plain API key.'),
      };
    }
  }

  async clearToken(): Promise<{ success: boolean; error?: string }> {
    try {
      await encryptedAppSecretsStore.deleteSecret(this.PLAIN_TOKEN_SECRET_KEY);
      this.cachedToken = null;
      this.client = null;
      this.clientToken = null;
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: toPlainErrorMessage(error, 'Failed to clear Plain API key.'),
      };
    }
  }

  async checkConnection(): Promise<ConnectionStatus> {
    try {
      const token = await this.getStoredToken();
      if (!token) {
        return {
          connected: false,
          capabilities: ISSUE_PROVIDER_CAPABILITIES.plain,
        };
      }

      const client = this.getClientForToken(token);
      await this.validateToken(client);

      return {
        connected: true,
        capabilities: ISSUE_PROVIDER_CAPABILITIES.plain,
      };
    } catch (error) {
      if (isNotConfigured(error)) {
        return {
          connected: false,
          capabilities: ISSUE_PROVIDER_CAPABILITIES.plain,
        };
      }

      return {
        connected: false,
        error: toPlainErrorMessage(error, 'Failed to verify Plain connection.'),
        capabilities: ISSUE_PROVIDER_CAPABILITIES.plain,
      };
    }
  }

  async getClient(): Promise<PlainClient | null> {
    const token = await this.getStoredToken();
    if (!token) {
      return null;
    }

    return this.getClientForToken(token);
  }

  private getClientForToken(token: string): PlainClient {
    if (!this.client || this.clientToken !== token) {
      this.client = new PlainClient({ apiKey: token });
      this.clientToken = token;
    }
    return this.client;
  }

  private async storeToken(token: string): Promise<void> {
    await encryptedAppSecretsStore.setSecret(this.PLAIN_TOKEN_SECRET_KEY, token);
    this.cachedToken = token;
  }

  private async getStoredToken(): Promise<string | null> {
    if (this.cachedToken !== undefined) {
      return this.cachedToken;
    }

    try {
      this.cachedToken = await encryptedAppSecretsStore.getSecret(this.PLAIN_TOKEN_SECRET_KEY);
      return this.cachedToken;
    } catch (error) {
      log.error('Failed to read Plain token from secure storage:', error);
      return null;
    }
  }

  private async validateToken(client: PlainClient): Promise<void> {
    try {
      await client.query.threads({ first: 1 });
    } catch (error) {
      if (error instanceof ForbiddenError) {
        throw new ForbiddenError(
          'Insufficient permissions: this key cannot read threads. Ensure thread read permissions are enabled.'
        );
      }
      if (error instanceof AuthenticationError || error instanceof RateLimitError) {
        throw error;
      }
      if (error instanceof PlainError) {
        throw error;
      }
      if (error instanceof Error) {
        throw new PlainError(error.message);
      }
      throw new PlainError(NOT_CONFIGURED_ERROR);
    }
  }
}

export const plainConnectionService = new PlainConnectionService();
