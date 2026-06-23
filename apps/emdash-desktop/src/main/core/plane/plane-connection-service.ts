import {
  hasKnownNetworkErrorCode,
  normalizeHostedInstanceUrl,
} from '@main/core/issues/helpers/hosted-instance';
import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';
import { KV } from '@main/db/kv';
import { ISSUE_PROVIDER_CAPABILITIES, type ConnectionStatus } from '@shared/issue-providers';
import {
  PLANE_CLOUD_API_BASE_URL,
  PlaneClient,
  PlaneHttpError,
  PlaneInvalidResponseError,
  readString,
} from './plane-client';

interface PlaneConnectionConfig {
  apiBaseUrl: string;
  workspaceSlug: string;
}

interface PlaneKVSchema extends Record<string, unknown> {
  connection: PlaneConnectionConfig;
}

const planeKV = new KV<PlaneKVSchema>('plane');
const NOT_CONFIGURED_ERROR = 'Plane is not configured. Connect Plane in settings.';
const PLANE_TOKEN_SECRET_KEY = 'emdash-plane-token';

export type PlaneCredentials = {
  apiBaseUrl: string;
  workspaceSlug: string;
  token: string;
};

export type PlaneAuth = PlaneConnectionConfig & {
  client: PlaneClient;
};

export function toPlaneErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof PlaneHttpError) {
    if (error.status === 401 || error.status === 403) {
      return 'Plane authentication failed. Check your API key and permissions.';
    }
    if (error.status === 404) {
      return 'Plane workspace, project, or work item not found.';
    }
    if (error.status === 429) {
      return 'Plane API rate limit exceeded. Please try again shortly.';
    }
    if (error.status >= 500) {
      return 'Plane API is temporarily unavailable. Please try again.';
    }
    return error.message || fallback;
  }

  if (error instanceof PlaneInvalidResponseError) {
    return error.message;
  }

  if (hasKnownNetworkErrorCode(error)) {
    return 'Unable to reach Plane instance. Check your URL and network connection.';
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

function isNotConfigured(error: unknown): boolean {
  return error instanceof Error && error.message === NOT_CONFIGURED_ERROR;
}

export class PlaneConnectionService {
  private client: PlaneClient | null = null;
  private clientKey: string | null = null;

  async saveCredentials(
    credentials: PlaneCredentials
  ): Promise<{ success: boolean; displayName?: string; error?: string }> {
    const normalizedUrl = normalizeHostedInstanceUrl(credentials.apiBaseUrl);
    if (!normalizedUrl) {
      return { success: false, error: 'A valid Plane API base URL is required.' };
    }

    const workspaceSlug = readString(credentials.workspaceSlug);
    if (!workspaceSlug) {
      return { success: false, error: 'A Plane workspace slug is required.' };
    }

    const token = credentials.token.trim();
    if (!token) {
      return { success: false, error: 'A Plane API key is required.' };
    }

    try {
      const client = this.getClientForCredentials(normalizedUrl, token);
      const user = await client.getCurrentUser();
      await client.listProjects(workspaceSlug, 1);

      await encryptedAppSecretsStore.setSecret(PLANE_TOKEN_SECRET_KEY, token);
      await this.writeConnection({ apiBaseUrl: normalizedUrl, workspaceSlug });

      return { success: true, displayName: toDisplayName(user) };
    } catch (error) {
      return {
        success: false,
        error: toPlaneErrorMessage(error, 'Failed to validate Plane credentials.'),
      };
    }
  }

  async clearCredentials(): Promise<{ success: boolean; error?: string }> {
    try {
      await encryptedAppSecretsStore.deleteSecret(PLANE_TOKEN_SECRET_KEY);
      await planeKV.del('connection');
      this.client = null;
      this.clientKey = null;
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: toPlaneErrorMessage(error, 'Failed to clear Plane credentials.'),
      };
    }
  }

  async checkConnection(): Promise<ConnectionStatus> {
    try {
      const { apiBaseUrl, client, workspaceSlug } = await this.requireAuth();
      const user = await client.getCurrentUser();
      await client.listProjects(workspaceSlug, 1);

      return {
        connected: true,
        displayName: toDisplayName(user),
        displayDetail: toDisplayDetail(workspaceSlug, apiBaseUrl),
        capabilities: ISSUE_PROVIDER_CAPABILITIES.plane,
      };
    } catch (error) {
      if (isNotConfigured(error)) {
        return {
          connected: false,
          capabilities: ISSUE_PROVIDER_CAPABILITIES.plane,
        };
      }

      return {
        connected: false,
        error: toPlaneErrorMessage(error, 'Failed to verify Plane connection.'),
        capabilities: ISSUE_PROVIDER_CAPABILITIES.plane,
      };
    }
  }

  async getAuth(): Promise<PlaneAuth | null> {
    try {
      return await this.requireAuth();
    } catch (error) {
      if (isNotConfigured(error)) {
        return null;
      }
      throw error;
    }
  }

  async isConfigured(): Promise<boolean> {
    const connection = await this.readConnection();
    if (!connection) return false;
    return !!(await encryptedAppSecretsStore.getSecret(PLANE_TOKEN_SECRET_KEY));
  }

  private async requireAuth(): Promise<PlaneAuth> {
    const connection = await this.readConnection();
    if (!connection) {
      throw new Error(NOT_CONFIGURED_ERROR);
    }

    const token = await encryptedAppSecretsStore.getSecret(PLANE_TOKEN_SECRET_KEY);
    if (!token) {
      throw new Error(NOT_CONFIGURED_ERROR);
    }

    return {
      ...connection,
      client: this.getClientForCredentials(connection.apiBaseUrl, token),
    };
  }

  private getClientForCredentials(apiBaseUrl: string, token: string): PlaneClient {
    const key = `${apiBaseUrl}|${token}`;
    if (!this.client || this.clientKey !== key) {
      this.client = new PlaneClient(apiBaseUrl, token);
      this.clientKey = key;
    }
    return this.client;
  }

  private async writeConnection(connection: PlaneConnectionConfig): Promise<void> {
    await planeKV.set('connection', connection);
  }

  private async readConnection(): Promise<PlaneConnectionConfig | null> {
    const connection = await planeKV.get('connection');
    const apiBaseUrl = readString(connection?.apiBaseUrl);
    const workspaceSlug = readString(connection?.workspaceSlug);
    if (!apiBaseUrl || !workspaceSlug) return null;
    return { apiBaseUrl, workspaceSlug };
  }
}

function toDisplayName(user: {
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
}): string | undefined {
  const displayName = readString(user.display_name);
  if (displayName) return displayName;

  const fullName = [readString(user.first_name), readString(user.last_name)]
    .filter(Boolean)
    .join(' ');
  return fullName || readString(user.email) || undefined;
}

function toDisplayDetail(workspaceSlug: string, apiBaseUrl: string): string {
  try {
    const host = new URL(apiBaseUrl).host;
    return `${workspaceSlug} on ${host}`;
  } catch {
    return workspaceSlug;
  }
}

export { PLANE_CLOUD_API_BASE_URL, PLANE_TOKEN_SECRET_KEY };
export const planeConnectionService = new PlaneConnectionService();
