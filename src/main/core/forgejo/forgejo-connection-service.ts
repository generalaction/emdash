import { userGetCurrent } from '@llamaduck/forgejo-ts';
import { createClient, type Client } from '@llamaduck/forgejo-ts/client';
import { AxiosError } from 'axios';
import keytar from 'keytar';
import { ISSUE_PROVIDER_CAPABILITIES, type ConnectionStatus } from '@shared/issue-providers';
import { resolveOriginRemote } from '@main/core/issues/git-remote-resolver';
import {
  assertRemoteHostMatchesInstance,
  hasKnownNetworkErrorCode,
  normalizeHostedInstanceUrl,
} from '@main/core/issues/helpers/hosted-instance';
import { KV } from '@main/db/kv';

interface ForgejoConnectionConfig {
  instanceUrl: string;
}

interface ForgejoKVSchema extends Record<string, unknown> {
  connection: ForgejoConnectionConfig;
}

const forgejoKV = new KV<ForgejoKVSchema>('forgejo');
const NOT_CONFIGURED_ERROR = 'Forgejo is not configured. Connect Forgejo in settings.';

export function toForgejoErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status;
    if (status === 401 || status === 403) {
      return 'Forgejo authentication failed. Check your token permissions.';
    }
    if (status === 404) {
      return 'Forgejo repository or resource not found.';
    }
    if (status === 429) {
      return 'Forgejo API rate limit exceeded. Please try again shortly.';
    }
    if (typeof status === 'number' && status >= 500) {
      return 'Forgejo API is temporarily unavailable. Please try again.';
    }
    return error.message || fallback;
  }

  if (hasKnownNetworkErrorCode(error)) {
    return 'Unable to reach Forgejo instance. Check your URL and network connection.';
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

function isNotConfigured(error: unknown): boolean {
  return error instanceof Error && error.message === NOT_CONFIGURED_ERROR;
}

export class ForgejoConnectionService {
  private readonly SERVICE_NAME = 'emdash-forgejo';
  private readonly ACCOUNT_NAME = 'api-token';

  private client: Client | null = null;
  private clientKey: string | null = null;

  async saveCredentials(
    instanceUrl: string,
    token: string
  ): Promise<{ success: boolean; username?: string; displayName?: string; error?: string }> {
    const normalizedUrl = normalizeHostedInstanceUrl(instanceUrl);
    if (!normalizedUrl) {
      return { success: false, error: 'A valid Forgejo instance URL is required.' };
    }

    const cleanToken = token.trim();
    if (!cleanToken) {
      return { success: false, error: 'A Forgejo API token is required.' };
    }

    try {
      const client = this.getClientForCredentials(normalizedUrl, cleanToken);
      const { data: user } = await userGetCurrent({ client, throwOnError: true });

      await keytar.setPassword(this.SERVICE_NAME, this.ACCOUNT_NAME, cleanToken);
      await this.writeConnection({ instanceUrl: normalizedUrl });

      const username = user?.login ?? undefined;
      const displayName = user?.full_name || username;

      return { success: true, username, displayName };
    } catch (error) {
      return {
        success: false,
        error: toForgejoErrorMessage(error, 'Failed to validate Forgejo credentials.'),
      };
    }
  }

  async clearCredentials(): Promise<{ success: boolean; error?: string }> {
    try {
      await keytar.deletePassword(this.SERVICE_NAME, this.ACCOUNT_NAME);
      await forgejoKV.del('connection');

      this.client = null;
      this.clientKey = null;

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: toForgejoErrorMessage(error, 'Failed to clear Forgejo credentials.'),
      };
    }
  }

  async checkConnection(): Promise<ConnectionStatus> {
    try {
      const { client } = await this.requireAuth();
      const { data: user } = await userGetCurrent({ client, throwOnError: true });

      const username = user?.login ?? undefined;
      const displayName = user?.full_name || username;

      return {
        connected: true,
        displayName,
        capabilities: ISSUE_PROVIDER_CAPABILITIES.forgejo,
      };
    } catch (error) {
      if (isNotConfigured(error)) {
        return {
          connected: false,
          capabilities: ISSUE_PROVIDER_CAPABILITIES.forgejo,
        };
      }

      return {
        connected: false,
        error: toForgejoErrorMessage(error, 'Failed to verify Forgejo connection.'),
        capabilities: ISSUE_PROVIDER_CAPABILITIES.forgejo,
      };
    }
  }

  async getClient(): Promise<Client | null> {
    try {
      const { client } = await this.requireAuth();
      return client;
    } catch (error) {
      if (isNotConfigured(error)) {
        return null;
      }
      throw error;
    }
  }

  async resolveRepo(
    projectPath: string
  ): Promise<{ client: Client; owner: string; repo: string; repoName: string }> {
    const { instanceUrl, client } = await this.requireAuth();
    const remote = await resolveOriginRemote(projectPath);

    assertRemoteHostMatchesInstance(remote.host, instanceUrl, 'Forgejo');

    const parts = remote.slug.split('/');
    if (parts.length < 2) {
      throw new Error('Unable to extract owner/repo from remote URL.');
    }

    const owner = parts[0];
    const repo = parts.slice(1).join('/');

    return { client, owner, repo, repoName: repo };
  }

  private async requireAuth(): Promise<{ instanceUrl: string; client: Client }> {
    const connection = await this.readConnection();
    if (!connection) {
      throw new Error(NOT_CONFIGURED_ERROR);
    }

    const token = await keytar.getPassword(this.SERVICE_NAME, this.ACCOUNT_NAME);
    if (!token) {
      throw new Error(NOT_CONFIGURED_ERROR);
    }

    return {
      instanceUrl: connection.instanceUrl,
      client: this.getClientForCredentials(connection.instanceUrl, token),
    };
  }

  private getClientForCredentials(instanceUrl: string, token: string): Client {
    const key = `${instanceUrl}|${token}`;
    if (!this.client || this.clientKey !== key) {
      this.client = createClient({
        baseURL: `${instanceUrl}/api/v1`,
        headers: {
          Authorization: `token ${token}`,
        },
      });
      this.clientKey = key;
    }

    return this.client;
  }

  private async writeConnection(connection: ForgejoConnectionConfig): Promise<void> {
    await forgejoKV.set('connection', connection);
  }

  private async readConnection(): Promise<ForgejoConnectionConfig | null> {
    const connection = await forgejoKV.get('connection');
    if (typeof connection?.instanceUrl !== 'string' || !connection.instanceUrl.trim()) return null;
    return { instanceUrl: connection.instanceUrl };
  }
}

export const forgejoConnectionService = new ForgejoConnectionService();
