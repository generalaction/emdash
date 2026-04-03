import {
  AuthenticationError,
  ForbiddenError,
  PlainClient,
  PlainError,
  RateLimitError,
} from '@team-plain/graphql';
import keytar from 'keytar';

// ── Public types ────────────────────────────────────────────────────────────

export interface PlainConnectionStatus {
  connected: boolean;
  error?: string;
}

export interface PlainThreadSummary {
  id: string;
  ref: string | null;
  title: string;
  description: string | null;
  status: string | null;
  priority: number | null;
  customer: { id: string; fullName: string | null; email: string | null } | null;
  labels: Array<{ id: string; name: string | null }>;
  updatedAt: string | null;
  url: string | null;
}

interface PlainThreadLike {
  id: string;
  ref?: string | null;
  title?: string | null;
  previewText?: string | null;
  description?: string | null;
  status?: string | null;
  priority?: number | null;
  updatedAt?: { iso8601: string } | null;
}

// ── Service ─────────────────────────────────────────────────────────────────

export class PlainService {
  private readonly SERVICE_NAME = 'emdash-plain';
  private readonly ACCOUNT_NAME = 'api-token';
  private readonly NOT_CONFIGURED_ERROR = 'Plain is not configured. Connect Plain in settings.';

  private _cachedToken: string | null | undefined = undefined;
  private _client: PlainClient | null = null;
  private _clientToken: string | null = null;

  private getClient(token: string): PlainClient {
    if (!this._client || this._clientToken !== token) {
      this._client = new PlainClient({ apiKey: token });
      this._clientToken = token;
    }
    return this._client;
  }

  async saveToken(token: string): Promise<{ success: boolean; error?: string }> {
    const clean = token.trim();
    if (!clean) {
      return { success: false, error: 'Plain API key cannot be empty.' };
    }

    try {
      const client = this.getClient(clean);
      await this.validateToken(client);
      await this.storeToken(clean);
      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        error: this.toErrorMessage(error, 'Failed to validate Plain API key.'),
      };
    }
  }

  async clearToken(): Promise<{ success: boolean; error?: string }> {
    try {
      await keytar.deletePassword(this.SERVICE_NAME, this.ACCOUNT_NAME);
      this._cachedToken = null;
      this._client = null;
      this._clientToken = null;
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: this.toErrorMessage(error, 'Failed to clear Plain API key.'),
      };
    }
  }

  async checkConnection(): Promise<PlainConnectionStatus> {
    try {
      const token = await this.getStoredToken();
      if (!token) {
        return { connected: false };
      }
      const client = this.getClient(token);
      await this.validateToken(client);
      return {
        connected: true,
      };
    } catch (error) {
      if (this.isNotConfigured(error)) {
        return { connected: false };
      }
      return {
        connected: false,
        error: this.toErrorMessage(error, 'Failed to verify Plain connection.'),
      };
    }
  }

  async initialFetch(limit = 50): Promise<PlainThreadSummary[]> {
    const token = await this.getStoredToken();
    if (!token) {
      throw new Error(this.NOT_CONFIGURED_ERROR);
    }

    const first = Math.min(Math.max(limit, 1), 100);
    const client = this.getClient(token);

    try {
      const connection = await client.query.threads({
        filters: { statuses: ['TODO'] },
        sortBy: { field: 'CREATED_AT', direction: 'DESC' },
        first,
      });

      return connection.nodes.map((thread) => this.mapThread(thread));
    } catch (error) {
      throw new Error(this.toErrorMessage(error, 'Failed to fetch Plain threads.'));
    }
  }

  async searchThreads(searchTerm: string, limit = 20): Promise<PlainThreadSummary[]> {
    const term = searchTerm.trim();
    if (!term || term.length < 2) return [];

    const token = await this.getStoredToken();
    if (!token) {
      throw new Error(this.NOT_CONFIGURED_ERROR);
    }

    const first = Math.min(Math.max(limit, 1), 100);
    const client = this.getClient(token);

    try {
      const result = await client.query.searchThreads({
        searchQuery: { term },
        first,
      });

      if (!result?.edges) return [];

      return result.edges.map((edge) => this.mapThread(edge.node.thread)).filter(Boolean);
    } catch (error) {
      console.error('[Plain] searchThreads error:', error);
      return [];
    }
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private mapThread(thread: PlainThreadLike): PlainThreadSummary {
    return {
      id: thread.id,
      ref: thread.ref ?? null,
      title: thread.title ?? '',
      description: thread.previewText ?? thread.description ?? null,
      status: thread.status ?? null,
      priority: thread.priority ?? null,
      customer: null,
      labels: [],
      updatedAt: thread.updatedAt?.iso8601 ?? null,
      url: null,
    };
  }

  private async storeToken(token: string): Promise<void> {
    await keytar.setPassword(this.SERVICE_NAME, this.ACCOUNT_NAME, token);
    this._cachedToken = token;
  }

  private async getStoredToken(): Promise<string | null> {
    if (this._cachedToken !== undefined) return this._cachedToken;
    try {
      this._cachedToken = await keytar.getPassword(this.SERVICE_NAME, this.ACCOUNT_NAME);
      return this._cachedToken;
    } catch (error) {
      console.error('Failed to read Plain token from keychain:', error);
      return null;
    }
  }

  private isNotConfigured(error: unknown): boolean {
    return error instanceof Error && error.message === this.NOT_CONFIGURED_ERROR;
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
      throw new PlainError('Failed to validate Plain API key.');
    }
  }

  private toErrorMessage(error: unknown, fallback: string): string {
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
}

export const plainService = new PlainService();
