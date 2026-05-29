import { AuthenticationLinearError, ForbiddenLinearError, LinearClient } from '@linear/sdk';
import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { ISSUE_PROVIDER_CAPABILITIES, type ConnectionStatus } from '@shared/issue-providers';

function isInvalidTokenError(error: unknown): boolean {
  // @linear/sdk maps generic 4xx responses, including HTTP 408 timeouts,
  // to AuthenticationLinearError. Only 401/403 prove the saved token is invalid.
  if (error instanceof AuthenticationLinearError) {
    return error.status === 401;
  }

  if (error instanceof ForbiddenLinearError) {
    return error.status === 403;
  }

  return false;
}

export class LinearConnectionService {
  private readonly LINEAR_TOKEN_SECRET_KEY = 'emdash-linear-token';

  /** Bumps when the stored credential changes, so in-flight checks cannot write stale state. */
  private tokenVersion = 0;
  private cachedToken: string | null | undefined = undefined;
  private client: LinearClient | null = null;
  private clientToken: string | null = null;
  /** `null` = no successful verification yet; `undefined` = verified, name unavailable. */
  private lastVerifiedDisplayName: string | undefined | null = null;
  private authFailure: { tokenVersion: number; message: string } | null = null;

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
      this.authFailure = null;
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
      this.setCachedToken(null);
      this.client = null;
      this.clientToken = null;
      this.lastVerifiedDisplayName = null;
      this.authFailure = null;
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
      this.lastVerifiedDisplayName = null;
      this.authFailure = null;
      return {
        connected: false,
        capabilities: ISSUE_PROVIDER_CAPABILITIES.linear,
      };
    }

    const tokenVersion = this.tokenVersion;

    try {
      const displayName = await this.fetchViewerDisplayName(token);
      if (this.tokenVersion !== tokenVersion) {
        return this.currentConnectionStatus();
      }

      this.lastVerifiedDisplayName = displayName;
      this.authFailure = null;
      return {
        connected: true,
        displayName,
        capabilities: ISSUE_PROVIDER_CAPABILITIES.linear,
      };
    } catch (error) {
      if (this.tokenVersion !== tokenVersion) {
        return this.currentConnectionStatus();
      }

      if (isInvalidTokenError(error)) {
        this.lastVerifiedDisplayName = null;
        const message = error instanceof Error ? error.message : 'Linear token rejected.';
        this.authFailure = { tokenVersion, message };
        return {
          connected: false,
          error: message,
          capabilities: ISSUE_PROVIDER_CAPABILITIES.linear,
        };
      }

      if (this.authFailure?.tokenVersion === tokenVersion) {
        return {
          connected: false,
          error: this.authFailure.message,
          capabilities: ISSUE_PROVIDER_CAPABILITIES.linear,
        };
      }

      log.warn('Linear connection check failed transiently; keeping connected:', error);
      return {
        connected: true,
        displayName: this.lastVerifiedDisplayName ?? undefined,
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

  private currentConnectionStatus(): ConnectionStatus {
    if (!this.cachedToken) {
      return {
        connected: false,
        capabilities: ISSUE_PROVIDER_CAPABILITIES.linear,
      };
    }

    if (this.authFailure?.tokenVersion === this.tokenVersion) {
      return {
        connected: false,
        error: this.authFailure.message,
        capabilities: ISSUE_PROVIDER_CAPABILITIES.linear,
      };
    }

    return {
      connected: true,
      displayName: this.lastVerifiedDisplayName ?? undefined,
      capabilities: ISSUE_PROVIDER_CAPABILITIES.linear,
    };
  }

  private async fetchViewerDisplayName(token: string): Promise<string | undefined> {
    const client = this.getClientForToken(token);
    const viewer = await client.viewer;
    const organization = await viewer.organization;
    return organization?.name ?? viewer.displayName ?? undefined;
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
      this.setCachedToken(token);
    } catch (error) {
      log.error('Failed to store Linear token:', error);
      throw new Error('Unable to store Linear token securely.');
    }
  }

  private setCachedToken(token: string | null): void {
    if (this.cachedToken === token) {
      return;
    }

    this.cachedToken = token;
    this.tokenVersion += 1;
    this.authFailure = null;
  }

  private async getStoredToken(): Promise<string | null> {
    if (this.cachedToken) {
      return this.cachedToken;
    }

    try {
      const token =
        (await encryptedAppSecretsStore.getSecret(this.LINEAR_TOKEN_SECRET_KEY)) ?? null;
      this.setCachedToken(token);
      return token;
    } catch (error) {
      log.error('Failed to read Linear token from secure storage:', error);
      return null;
    }
  }
}

export const linearConnectionService = new LinearConnectionService();
