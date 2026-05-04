import { AuthenticationLinearError, ForbiddenLinearError, LinearClient } from '@linear/sdk';
import { ISSUE_PROVIDER_CAPABILITIES, type ConnectionStatus } from '@shared/issue-providers';
import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';

const VIEWER_QUERY = `
  query EmdashLinearViewer {
    viewer {
      id
      displayName
      organization {
        id
        name
      }
    }
  }
`;

type ViewerQueryResult = {
  viewer: {
    id: string;
    displayName: string | null;
    organization: { id: string; name: string | null } | null;
  } | null;
};

function isAuthFailure(error: unknown): boolean {
  return error instanceof AuthenticationLinearError || error instanceof ForbiddenLinearError;
}

export class LinearConnectionService {
  private readonly LINEAR_TOKEN_SECRET_KEY = 'emdash-linear-token';

  private cachedToken: string | null | undefined = undefined;
  private client: LinearClient | null = null;
  private clientToken: string | null = null;
  private lastVerifiedDisplayName: string | undefined = undefined;

  async saveToken(
    token: string
  ): Promise<{ success: boolean; workspaceName?: string; error?: string }> {
    try {
      const clean = token.trim();
      if (!clean) {
        return { success: false, error: 'Linear token cannot be empty.' };
      }

      const displayName = await this.fetchViewerDisplayName(clean);

      await this.storeToken(clean);
      this.lastVerifiedDisplayName = displayName;
      telemetryService.capture('integration_connected', { provider: 'linear' });

      return {
        success: true,
        workspaceName: displayName,
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
      await encryptedAppSecretsStore.deleteSecret(this.LINEAR_TOKEN_SECRET_KEY);
      this.cachedToken = null;
      this.client = null;
      this.clientToken = null;
      this.lastVerifiedDisplayName = undefined;
      telemetryService.capture('integration_disconnected', { provider: 'linear' });
      return { success: true };
    } catch (error) {
      log.error('Failed to clear Linear token:', error);
      return {
        success: false,
        error: 'Unable to remove Linear token from secure storage.',
      };
    }
  }

  async checkConnection(): Promise<ConnectionStatus> {
    const token = await this.getStoredToken();
    if (!token) {
      this.lastVerifiedDisplayName = undefined;
      return {
        connected: false,
        capabilities: ISSUE_PROVIDER_CAPABILITIES.linear,
      };
    }

    try {
      const displayName = await this.fetchViewerDisplayName(token);
      this.lastVerifiedDisplayName = displayName;
      return {
        connected: true,
        displayName,
        capabilities: ISSUE_PROVIDER_CAPABILITIES.linear,
      };
    } catch (error) {
      if (isAuthFailure(error)) {
        this.lastVerifiedDisplayName = undefined;
        const message = error instanceof Error ? error.message : 'Linear token rejected.';
        return {
          connected: false,
          error: message,
          capabilities: ISSUE_PROVIDER_CAPABILITIES.linear,
        };
      }

      if (this.lastVerifiedDisplayName === undefined) {
        return {
          connected: false,
          error: 'Unable to verify Linear connection. Please try again.',
          capabilities: ISSUE_PROVIDER_CAPABILITIES.linear,
        };
      }

      log.warn('Linear connection check failed transiently; keeping connected:', error);
      return {
        connected: true,
        displayName: this.lastVerifiedDisplayName,
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

  private async fetchViewerDisplayName(token: string): Promise<string | undefined> {
    const client = this.getClientForToken(token);
    const { data } = await client.client.rawRequest<ViewerQueryResult, Record<string, never>>(
      VIEWER_QUERY,
      {}
    );
    return data?.viewer?.organization?.name ?? data?.viewer?.displayName ?? undefined;
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
      await encryptedAppSecretsStore.setSecret(this.LINEAR_TOKEN_SECRET_KEY, token);
      this.cachedToken = token;
    } catch (error) {
      log.error('Failed to store Linear token:', error);
      throw new Error('Unable to store Linear token securely.');
    }
  }

  private async getStoredToken(): Promise<string | null> {
    if (this.cachedToken) {
      return this.cachedToken;
    }

    try {
      this.cachedToken = await encryptedAppSecretsStore.getSecret(this.LINEAR_TOKEN_SECRET_KEY);
      return this.cachedToken;
    } catch (error) {
      log.error('Failed to read Linear token from secure storage:', error);
      return null;
    }
  }
}

export const linearConnectionService = new LinearConnectionService();
