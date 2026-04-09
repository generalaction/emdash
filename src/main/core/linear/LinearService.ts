import { LinearClient } from '@linear/sdk';
import keytar from 'keytar';
import { capture } from '@main/lib/telemetry';

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  state: { name: string; type: string; color: string } | null;
  team: { name: string; key: string } | null;
  project: { name: string } | null;
  assignee: { displayName: string; name: string } | null;
  updatedAt: string;
}

export interface LinearConnectionStatus {
  connected: boolean;
  workspaceName?: string;
  error?: string;
}

const ISSUES_QUERY = `
  query ListIssues($limit: Int!) {
    issues(
      first: $limit,
      orderBy: updatedAt,
      filter: { state: { type: { nin: ["completed", "cancelled"] } } }
    ) {
      nodes {
        id
        identifier
        title
        description
        url
        state { name type color }
        team { name key }
        project { name }
        assignee { displayName name }
        updatedAt
      }
    }
  }
`;

const SEARCH_QUERY = `
  query SearchIssues($term: String!, $limit: Int!) {
    searchIssues(term: $term, first: $limit) {
      nodes {
        id
        identifier
        title
        description
        url
        state { name type color }
        team { name key }
        project { name }
        assignee { displayName name }
        updatedAt
      }
    }
  }
`;

export class LinearService {
  private readonly SERVICE_NAME = 'emdash-linear';
  private readonly ACCOUNT_NAME = 'api-token';

  // In-memory token cache: undefined = not yet loaded, null = no token, string = valid token
  private _cachedToken: string | null | undefined = undefined;

  private _client: LinearClient | null = null;
  private _clientToken: string | null = null;

  private getClient(token: string): LinearClient {
    if (!this._client || this._clientToken !== token) {
      this._client = new LinearClient({ apiKey: token });
      this._clientToken = token;
    }
    return this._client;
  }

  async saveToken(
    token: string
  ): Promise<{ success: boolean; workspaceName?: string; error?: string }> {
    try {
      const client = this.getClient(token);
      const viewer = await client.viewer;
      const org = await viewer.organization;
      await this.storeToken(token);
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
      this._cachedToken = null;
      this._client = null;
      this._clientToken = null;
      capture('integration_disconnected', { provider: 'linear' });
      return { success: true };
    } catch (error) {
      console.error('Failed to clear Linear token:', error);
      return {
        success: false,
        error: 'Unable to remove Linear token from keychain.',
      };
    }
  }

  async checkConnection(): Promise<LinearConnectionStatus> {
    try {
      const token = await this.getStoredToken();
      if (!token) {
        return { connected: false };
      }
      const client = this.getClient(token);
      const viewer = await client.viewer;
      const org = await viewer.organization;
      return {
        connected: true,
        workspaceName: org?.name ?? viewer.displayName ?? undefined,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to verify Linear connection.';
      return { connected: false, error: message };
    }
  }

  async initialFetch(limit = 50): Promise<LinearIssue[]> {
    const token = await this.getStoredToken();
    if (!token) {
      throw new Error('Linear token not set. Connect Linear in settings first.');
    }

    const sanitizedLimit = Math.min(Math.max(limit, 1), 200);
    const client = this.getClient(token);

    const { data } = await client.client.rawRequest<
      { issues: { nodes: LinearIssue[] } },
      { limit: number }
    >(ISSUES_QUERY, { limit: sanitizedLimit });

    return data?.issues?.nodes ?? [];
  }

  async searchIssues(searchTerm: string, limit = 20): Promise<LinearIssue[]> {
    const token = await this.getStoredToken();
    if (!token) {
      throw new Error('Linear token not set. Connect Linear in settings first.');
    }

    if (!searchTerm.trim()) {
      return [];
    }

    const sanitizedLimit = Math.min(Math.max(limit, 1), 200);
    const client = this.getClient(token);

    try {
      const { data } = await client.client.rawRequest<
        { searchIssues: { nodes: LinearIssue[] } },
        { term: string; limit: number }
      >(SEARCH_QUERY, {
        term: searchTerm.trim(),
        limit: sanitizedLimit,
      });

      return data?.searchIssues?.nodes ?? [];
    } catch (error) {
      console.error('[Linear] searchIssues error:', error);
      return [];
    }
  }

  private async storeToken(token: string): Promise<void> {
    const clean = token.trim();
    if (!clean) {
      throw new Error('Linear token cannot be empty.');
    }

    try {
      await keytar.setPassword(this.SERVICE_NAME, this.ACCOUNT_NAME, clean);
      this._cachedToken = clean;
    } catch (error) {
      console.error('Failed to store Linear token:', error);
      throw new Error('Unable to store Linear token securely.');
    }
  }

  private async getStoredToken(): Promise<string | null> {
    if (this._cachedToken !== undefined) return this._cachedToken;
    try {
      this._cachedToken = await keytar.getPassword(this.SERVICE_NAME, this.ACCOUNT_NAME);
      return this._cachedToken;
    } catch (error) {
      console.error('Failed to read Linear token from keychain:', error);
      return null;
    }
  }
}

export const linearService = new LinearService();
