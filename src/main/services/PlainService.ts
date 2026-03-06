import { request } from 'node:https';
import { URL } from 'node:url';
import { app } from 'electron';
import { join } from 'node:path';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';

const PLAIN_API_URL = 'https://core-api.uk.plain.com/graphql/v1';
const REQUEST_TIMEOUT_MS = 15_000;

const THREAD_FIELDS = `
  id ref title previewText status priority
  customer { id fullName email { email } }
  labels { labelType { id name } }
  updatedAt { iso8601 }
`;

export interface PlainWorkspace {
  id: string;
  name: string;
}

export interface PlainConnectionStatus {
  connected: boolean;
  workspaceName?: string;
  error?: string;
}

/** Thread shape returned by mapThread — mirrors PlainThreadSummary in renderer types. */
export interface PlainThread {
  id: string;
  ref: string | null;
  title: string;
  description: string | null;
  status: string | null;
  priority: number | null;
  customer: { id: string; fullName: string | null; email: string | null } | null;
  labels: Array<{ id: string; name: string | null }> | null;
  updatedAt: string | null;
  url: string | null;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export class PlainService {
  private readonly SERVICE_NAME = 'emdash-plain';
  private readonly ACCOUNT_NAME = 'api-token';

  async saveToken(
    token: string
  ): Promise<{ success: boolean; workspaceName?: string; error?: string }> {
    try {
      const workspace = await this.fetchWorkspace(token);
      await this.storeToken(token);
      this.saveWorkspaceId(workspace.id);
      void import('../telemetry').then(({ capture }) => {
        void capture('plain_connected');
      });
      return {
        success: true,
        workspaceName: workspace.name ?? undefined,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to validate Plain token. Please try again.';
      return { success: false, error: message };
    }
  }

  async clearToken(): Promise<{ success: boolean; error?: string }> {
    try {
      const keytar = await import('keytar');
      await keytar.deletePassword(this.SERVICE_NAME, this.ACCOUNT_NAME);
      this.clearWorkspaceId();
      void import('../telemetry').then(({ capture }) => {
        void capture('plain_disconnected');
      });
      return { success: true };
    } catch (error) {
      console.error('Failed to clear Plain token:', error);
      return {
        success: false,
        error: 'Unable to remove Plain token from keychain.',
      };
    }
  }

  async checkConnection(): Promise<PlainConnectionStatus> {
    try {
      const token = await this.getStoredToken();
      if (!token) {
        return { connected: false };
      }

      const workspace = await this.fetchWorkspace(token);
      return {
        connected: true,
        workspaceName: workspace.name ?? undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to verify Plain connection.';
      return { connected: false, error: message };
    }
  }

  async initialFetch(limit = 50, statuses?: string[]): Promise<PlainThread[]> {
    const token = await this.getStoredToken();
    if (!token) {
      throw new Error('Plain token not set. Connect Plain in settings first.');
    }

    const sanitizedLimit = Math.min(Math.max(limit, 1), 200);
    const workspaceId = this.loadWorkspaceId();

    const hasStatuses = statuses && statuses.length > 0;

    const query = hasStatuses
      ? `
      query ListThreads($first: Int!, $statuses: [ThreadStatus!]!) {
        threads(first: $first, filters: { statuses: $statuses }, sortBy: { field: CREATED_AT, direction: DESC }) {
          edges { node { ${THREAD_FIELDS} } }
        }
      }
    `
      : `
      query ListThreads($first: Int!) {
        threads(first: $first, sortBy: { field: CREATED_AT, direction: DESC }) {
          edges { node { ${THREAD_FIELDS} } }
        }
      }
    `;

    const variables: Record<string, unknown> = { first: sanitizedLimit };
    if (hasStatuses) variables.statuses = statuses;

    const response = await this.graphql<{
      threads: { edges: Array<{ node: any }> };
    }>(token, query, variables);

    const threads = (response?.threads?.edges ?? []).map((edge) =>
      this.mapThread(edge.node, workspaceId)
    );

    return threads;
  }

  async searchThreads(searchTerm: string, limit = 20): Promise<PlainThread[]> {
    const token = await this.getStoredToken();
    if (!token) {
      throw new Error('Plain token not set. Connect Plain in settings first.');
    }

    const trimmed = searchTerm.trim();
    if (!trimmed) {
      return [];
    }

    const workspaceId = this.loadWorkspaceId();
    const isRefSearch = /^T-\d+$/i.test(trimmed);

    try {
      if (isRefSearch) {
        return await this.fetchThreadByRef(token, trimmed.toUpperCase(), workspaceId);
      }

      // Plain has no server-side text search — fetch a wide batch and filter client-side
      const fetchSize = 200;
      const resultLimit = Math.min(Math.max(limit, 1), 200);
      const query = `
        query SearchThreads($first: Int!) {
          threads(first: $first, sortBy: { field: CREATED_AT, direction: DESC }) {
            edges { node { ${THREAD_FIELDS} } }
          }
        }
      `;

      const response = await this.graphql<{
        threads: { edges: Array<{ node: any }> };
      }>(token, query, { first: fetchSize });

      const lowerTerm = trimmed.toLowerCase();
      const threads = (response?.threads?.edges ?? [])
        .map((edge) => this.mapThread(edge.node, workspaceId))
        .filter(
          (t) =>
            (t.title && t.title.toLowerCase().includes(lowerTerm)) ||
            (t.ref && t.ref.toLowerCase().includes(lowerTerm)) ||
            (t.customer?.fullName && t.customer.fullName.toLowerCase().includes(lowerTerm)) ||
            (t.customer?.email && t.customer.email.toLowerCase().includes(lowerTerm))
        )
        .slice(0, resultLimit);

      return threads;
    } catch (error) {
      console.error('[Plain] searchThreads error:', error);
      return [];
    }
  }

  private async fetchThreadByRef(
    token: string,
    ref: string,
    workspaceId: string | null
  ): Promise<PlainThread[]> {
    const query = `
      query GetThreadByRef($ref: String!) {
        threadByRef(ref: $ref) { ${THREAD_FIELDS} }
      }
    `;

    try {
      const response = await this.graphql<{ threadByRef: any | null }>(token, query, { ref });
      if (!response?.threadByRef) return [];
      return [this.mapThread(response.threadByRef, workspaceId)];
    } catch {
      return [];
    }
  }

  private mapThread(node: any, workspaceId: string | null): PlainThread {
    return {
      id: node.id,
      ref: node.ref ?? null,
      title: node.title ?? '',
      description: node.previewText ?? node.description ?? null,
      status: node.status ?? null,
      priority: node.priority ?? null,
      customer: node.customer
        ? {
            id: node.customer.id,
            fullName: node.customer.fullName ?? null,
            email: node.customer.email?.email ?? null,
          }
        : null,
      labels: Array.isArray(node.labels)
        ? node.labels.map((l: any) => ({
            id: l.labelType?.id ?? l.id,
            name: l.labelType?.name ?? l.name ?? null,
          }))
        : null,
      updatedAt: node.updatedAt?.iso8601 ?? null,
      url: workspaceId ? `https://app.plain.com/workspace/${workspaceId}/t/${node.id}` : null,
    };
  }

  private async fetchWorkspace(token: string): Promise<PlainWorkspace> {
    const query = `
      query WorkspaceInfo {
        myWorkspace {
          id
          name
        }
      }
    `;

    const data = await this.graphql<{ myWorkspace: PlainWorkspace }>(token, query);
    if (!data?.myWorkspace) {
      throw new Error('Unable to retrieve Plain workspace information.');
    }
    return data.myWorkspace;
  }

  private saveWorkspaceId(workspaceId: string): void {
    try {
      const filePath = join(app.getPath('userData'), 'plain.json');
      writeFileSync(filePath, JSON.stringify({ workspaceId }), 'utf-8');
    } catch (error) {
      console.error('Failed to save Plain workspace ID:', error);
    }
  }

  private loadWorkspaceId(): string | null {
    try {
      const filePath = join(app.getPath('userData'), 'plain.json');
      const data = JSON.parse(readFileSync(filePath, 'utf-8'));
      return data?.workspaceId ?? null;
    } catch {
      return null;
    }
  }

  private clearWorkspaceId(): void {
    try {
      unlinkSync(join(app.getPath('userData'), 'plain.json'));
    } catch {
      // file may not exist
    }
  }

  private async graphql<T>(
    token: string,
    query: string,
    variables?: Record<string, unknown>
  ): Promise<T> {
    const body = JSON.stringify({ query, variables });

    const requestPromise = new Promise<GraphQLResponse<T>>((resolve, reject) => {
      const url = new URL(PLAIN_API_URL);

      const req = request(
        {
          hostname: url.hostname,
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            'Content-Length': Buffer.byteLength(body).toString(),
          },
        },
        (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            if (res.statusCode === 401 || res.statusCode === 403) {
              reject(new Error('Invalid API key. Please check your Plain API key and try again.'));
              return;
            }
            try {
              const parsed = JSON.parse(data) as GraphQLResponse<T>;
              resolve(parsed);
            } catch (error) {
              reject(error);
            }
          });
        }
      );

      req.setTimeout(REQUEST_TIMEOUT_MS, () => {
        req.destroy(new Error('Plain API request timed out.'));
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.write(body);
      req.end();
    });

    const result = await requestPromise;

    if (result.errors?.length) {
      throw new Error(result.errors.map((err) => err.message).join('\n'));
    }

    if (!result.data) {
      throw new Error('Plain API returned no data.');
    }

    return result.data;
  }

  private async storeToken(token: string): Promise<void> {
    const clean = token.trim();
    if (!clean) {
      throw new Error('Plain token cannot be empty.');
    }

    try {
      const keytar = await import('keytar');
      await keytar.setPassword(this.SERVICE_NAME, this.ACCOUNT_NAME, clean);
    } catch (error) {
      console.error('Failed to store Plain token:', error);
      throw new Error('Unable to store Plain token securely.');
    }
  }

  private async getStoredToken(): Promise<string | null> {
    try {
      const keytar = await import('keytar');
      return await keytar.getPassword(this.SERVICE_NAME, this.ACCOUNT_NAME);
    } catch (error) {
      console.error('Failed to read Plain token from keychain:', error);
      return null;
    }
  }
}

export default PlainService;
