import { GitbeakerRequestError, Gitlab } from '@gitbeaker/rest';
import keytar from 'keytar';
import { ISSUE_PROVIDER_CAPABILITIES, type ConnectionStatus } from '@shared/issue-providers';
import { resolveOriginRemote } from '@main/core/issues/git-remote-resolver';
import {
  assertRemoteHostMatchesInstance,
  hasKnownNetworkErrorCode,
  normalizeHostedInstanceUrl,
} from '@main/core/issues/helpers/hosted-instance';
import { KV } from '@main/db/kv';

interface GitLabConnectionConfig {
  instanceUrl: string;
}

interface GitLabKVSchema extends Record<string, unknown> {
  connection: GitLabConnectionConfig;
}

const gitlabKV = new KV<GitLabKVSchema>('gitlab');

const NOT_CONFIGURED_ERROR = 'GitLab is not configured. Connect GitLab in settings.';

export function toGitLabErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof GitbeakerRequestError) {
    const status = error.cause?.response?.status;
    if (status === 401 || status === 403) {
      return 'GitLab authentication failed. Check your token permissions.';
    }
    if (status === 404) {
      return 'GitLab project or resource not found.';
    }
    if (status === 429) {
      return 'GitLab API rate limit exceeded. Please try again shortly.';
    }
    if (typeof status === 'number' && status >= 500) {
      return 'GitLab API is temporarily unavailable. Please try again.';
    }
    return error.message || fallback;
  }

  if (hasKnownNetworkErrorCode(error)) {
    return 'Unable to reach GitLab instance. Check your URL and network connection.';
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

function isNotConfigured(error: unknown): boolean {
  return error instanceof Error && error.message === NOT_CONFIGURED_ERROR;
}

export class GitLabConnectionService {
  private readonly SERVICE_NAME = 'emdash-gitlab';
  private readonly ACCOUNT_NAME = 'api-token';

  private client: Gitlab | null = null;
  private clientKey: string | null = null;

  async saveCredentials(
    instanceUrl: string,
    token: string
  ): Promise<{ success: boolean; username?: string; displayName?: string; error?: string }> {
    const normalizedUrl = normalizeHostedInstanceUrl(instanceUrl);
    if (!normalizedUrl) {
      return { success: false, error: 'A valid GitLab instance URL is required.' };
    }

    const cleanToken = token.trim();
    if (!cleanToken) {
      return { success: false, error: 'A GitLab API token is required.' };
    }

    try {
      const client = this.getClientForCredentials(normalizedUrl, cleanToken);
      const user = (await client.Users.showCurrentUser()) as Record<string, unknown>;

      await keytar.setPassword(this.SERVICE_NAME, this.ACCOUNT_NAME, cleanToken);
      await this.writeConnection({ instanceUrl: normalizedUrl });

      const username = this.readString(user.username) ?? undefined;
      const displayName = this.readString(user.name) ?? username;

      return { success: true, username, displayName };
    } catch (error) {
      return {
        success: false,
        error: toGitLabErrorMessage(error, 'Failed to validate GitLab credentials.'),
      };
    }
  }

  async clearCredentials(): Promise<{ success: boolean; error?: string }> {
    try {
      await keytar.deletePassword(this.SERVICE_NAME, this.ACCOUNT_NAME);
      await gitlabKV.del('connection');

      this.client = null;
      this.clientKey = null;

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: toGitLabErrorMessage(error, 'Failed to clear GitLab credentials.'),
      };
    }
  }

  async checkConnection(): Promise<ConnectionStatus> {
    try {
      const { client } = await this.requireAuth();
      const user = (await client.Users.showCurrentUser()) as Record<string, unknown>;

      const username = this.readString(user.username) ?? undefined;
      const displayName = this.readString(user.name) ?? username;

      return {
        connected: true,
        displayName,
        capabilities: ISSUE_PROVIDER_CAPABILITIES.gitlab,
      };
    } catch (error) {
      if (isNotConfigured(error)) {
        return {
          connected: false,
          capabilities: ISSUE_PROVIDER_CAPABILITIES.gitlab,
        };
      }

      return {
        connected: false,
        error: toGitLabErrorMessage(error, 'Failed to verify GitLab connection.'),
        capabilities: ISSUE_PROVIDER_CAPABILITIES.gitlab,
      };
    }
  }

  async getClient(): Promise<Gitlab | null> {
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

  async resolveProject(
    projectPath: string
  ): Promise<{ client: Gitlab; projectId: number; projectName: string | null }> {
    const { instanceUrl, client } = await this.requireAuth();
    const remote = await resolveOriginRemote(projectPath);

    assertRemoteHostMatchesInstance(remote.host, instanceUrl, 'GitLab');

    try {
      const project = (await client.Projects.show(encodeURIComponent(remote.slug))) as Record<
        string,
        unknown
      >;
      const projectId = this.readNumber(project.id);
      if (projectId === null) {
        throw new Error('Unable to resolve GitLab project ID.');
      }

      return {
        client,
        projectId,
        projectName: this.readString(project.name),
      };
    } catch (error) {
      throw new Error(toGitLabErrorMessage(error, 'Unable to resolve GitLab project from origin.'));
    }
  }

  private async requireAuth(): Promise<{ instanceUrl: string; client: Gitlab }> {
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

  private getClientForCredentials(instanceUrl: string, token: string): Gitlab {
    const key = `${instanceUrl}|${token}`;
    if (!this.client || this.clientKey !== key) {
      this.client = new Gitlab({ host: instanceUrl, token });
      this.clientKey = key;
    }

    return this.client;
  }

  private async writeConnection(connection: GitLabConnectionConfig): Promise<void> {
    await gitlabKV.set('connection', connection);
  }

  private async readConnection(): Promise<GitLabConnectionConfig | null> {
    const connection = await gitlabKV.get('connection');
    const instanceUrl = this.readString(connection?.instanceUrl);
    if (!instanceUrl) return null;
    return { instanceUrl };
  }

  private readString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  }
}

export const gitLabConnectionService = new GitLabConnectionService();
