import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { issueListIssues, userGetCurrent, type Issue as ForgejoIssue } from '@llamaduck/forgejo-ts';
import { createClient, type Client } from '@llamaduck/forgejo-ts/client';
import { AxiosError } from 'axios';
import keytar from 'keytar';
import { KV } from '@main/db/kv';

const execFileAsync = promisify(execFile);

interface ForgejoConnectionConfig {
  instanceUrl: string;
}

interface ForgejoKVSchema extends Record<string, unknown> {
  connection: ForgejoConnectionConfig;
}

export interface ForgejoConnectionStatus {
  connected: boolean;
  username?: string;
  displayName?: string;
  instanceUrl?: string;
  error?: string;
}

export interface ForgejoIssueSummary {
  id: number;
  number: number;
  title: string;
  description: string | null;
  htmlUrl: string | null;
  state: string | null;
  repo: string | null;
  assignee: { name: string; username: string } | null;
  labels: string[];
  updatedAt: string | null;
}

const forgejoKV = new KV<ForgejoKVSchema>('forgejo');

export class ForgejoService {
  private readonly SERVICE_NAME = 'emdash-forgejo';
  private readonly ACCOUNT_NAME = 'api-token';
  private readonly NOT_CONFIGURED_ERROR = 'Forgejo is not configured. Connect Forgejo in settings.';

  private client: Client | null = null;
  private clientKey: string | null = null;

  async saveCredentials(
    instanceUrl: string,
    token: string
  ): Promise<{ success: boolean; username?: string; displayName?: string; error?: string }> {
    const normalizedUrl = this.normalizeInstanceUrl(instanceUrl);
    if (!normalizedUrl) {
      return { success: false, error: 'A valid Forgejo instance URL is required.' };
    }

    const cleanToken = token.trim();
    if (!cleanToken) {
      return { success: false, error: 'A Forgejo API token is required.' };
    }

    try {
      const client = this.getClient(normalizedUrl, cleanToken);
      const { data: user } = await userGetCurrent({ client, throwOnError: true });

      await keytar.setPassword(this.SERVICE_NAME, this.ACCOUNT_NAME, cleanToken);
      await this.writeConnection({ instanceUrl: normalizedUrl });

      const username = user?.login ?? undefined;
      const displayName = user?.full_name || username;

      return { success: true, username, displayName };
    } catch (error) {
      return {
        success: false,
        error: this.toErrorMessage(error, 'Failed to validate Forgejo credentials.'),
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
        error: this.toErrorMessage(error, 'Failed to clear Forgejo credentials.'),
      };
    }
  }

  async checkConnection(): Promise<ForgejoConnectionStatus> {
    try {
      const { instanceUrl, client } = await this.requireAuth();
      const { data: user } = await userGetCurrent({ client, throwOnError: true });

      const username = user?.login ?? undefined;
      const displayName = user?.full_name || username;

      return {
        connected: true,
        username,
        displayName,
        instanceUrl,
      };
    } catch (error) {
      if (this.isNotConfigured(error)) {
        return { connected: false };
      }

      return {
        connected: false,
        error: this.toErrorMessage(error, 'Failed to verify Forgejo connection.'),
      };
    }
  }

  async initialFetch(projectPath: string, limit = 50): Promise<ForgejoIssueSummary[]> {
    const path = projectPath.trim();
    if (!path) {
      throw new Error('Project path is required.');
    }

    const perPage = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 100)) : 50;
    const { client, owner, repo, repoName } = await this.resolveRepo(path);

    try {
      const { data: issues } = await issueListIssues({
        client,
        path: { owner, repo },
        query: { state: 'open', type: 'issues', sort: 'recentupdate', limit: perPage },
        throwOnError: true,
      });

      return (issues ?? []).map((issue) => this.mapIssue(issue, repoName));
    } catch (error) {
      throw new Error(this.toErrorMessage(error, 'Failed to fetch Forgejo issues.'));
    }
  }

  async searchIssues(
    projectPath: string,
    searchTerm: string,
    limit = 20
  ): Promise<ForgejoIssueSummary[]> {
    const path = projectPath.trim();
    if (!path) {
      throw new Error('Project path is required.');
    }

    const term = searchTerm.trim();
    if (!term) return [];

    const perPage = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 100)) : 20;
    const { client, owner, repo, repoName } = await this.resolveRepo(path);

    try {
      const { data: issues } = await issueListIssues({
        client,
        path: { owner, repo },
        query: {
          state: 'open',
          type: 'issues',
          q: term,
          sort: 'recentupdate',
          limit: perPage,
        },
        throwOnError: true,
      });

      return (issues ?? []).map((issue) => this.mapIssue(issue, repoName));
    } catch (error) {
      throw new Error(this.toErrorMessage(error, 'Failed to search Forgejo issues.'));
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async requireAuth(): Promise<{
    instanceUrl: string;
    client: Client;
  }> {
    const connection = await this.readConnection();
    if (!connection) {
      throw new Error(this.NOT_CONFIGURED_ERROR);
    }

    const token = await keytar.getPassword(this.SERVICE_NAME, this.ACCOUNT_NAME);
    if (!token) {
      throw new Error(this.NOT_CONFIGURED_ERROR);
    }

    return {
      instanceUrl: connection.instanceUrl,
      client: this.getClient(connection.instanceUrl, token),
    };
  }

  private async resolveRepo(
    projectPath: string
  ): Promise<{ client: Client; owner: string; repo: string; repoName: string }> {
    const { instanceUrl, client } = await this.requireAuth();
    const remoteUrl = await this.getOriginRemoteUrl(projectPath);
    const remote = this.parseRemoteUrl(remoteUrl);
    if (!remote) {
      throw new Error('Unable to parse git remote URL from origin.');
    }

    const instanceHost = new URL(instanceUrl).hostname.toLowerCase();
    if (remote.host !== instanceHost) {
      throw new Error(
        `Git remote host "${remote.host}" does not match configured Forgejo instance "${instanceHost}".`
      );
    }

    const parts = remote.slug.split('/');
    if (parts.length < 2) {
      throw new Error('Unable to extract owner/repo from remote URL.');
    }

    const owner = parts[0];
    const repo = parts.slice(1).join('/');

    return { client, owner, repo, repoName: repo };
  }

  private async getOriginRemoteUrl(projectPath: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
        cwd: projectPath,
        encoding: 'utf8',
      });
      const remote = String(stdout || '').trim();
      if (!remote) {
        throw new Error('No remote URL found for origin.');
      }
      return remote;
    } catch {
      throw new Error('No remote URL found for origin.');
    }
  }

  private parseRemoteUrl(remoteUrl: string): { host: string; slug: string } | null {
    const raw = String(remoteUrl || '').trim();
    if (!raw) return null;

    const scpLike = /^git@([^:]+):(.+?)(?:\.git)?$/.exec(raw);
    if (scpLike) {
      return {
        host: scpLike[1].toLowerCase(),
        slug: scpLike[2].replace(/\/+$/, ''),
      };
    }

    if (raw.startsWith('ssh://')) {
      try {
        const parsed = new URL(raw);
        const slug = parsed.pathname
          .replace(/^\/+/, '')
          .replace(/\.git$/, '')
          .replace(/\/+$/, '');
        if (!slug) return null;
        return { host: parsed.hostname.toLowerCase(), slug };
      } catch {
        return null;
      }
    }

    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      try {
        const parsed = new URL(raw);
        const slug = parsed.pathname
          .replace(/^\/+/, '')
          .replace(/\.git$/, '')
          .replace(/\/+$/, '');
        if (!slug) return null;
        return { host: parsed.hostname.toLowerCase(), slug };
      } catch {
        return null;
      }
    }

    return null;
  }

  private mapIssue(issue: ForgejoIssue, repoName: string): ForgejoIssueSummary {
    const assignee = issue.assignee;
    const assigneeName = assignee?.full_name || assignee?.login;
    const assigneeLogin = assignee?.login || assignee?.full_name;

    return {
      id: issue.id ?? 0,
      number: issue.number ?? 0,
      title: issue.title ?? '',
      description: issue.body ?? null,
      htmlUrl: issue.html_url ?? null,
      state: issue.state ?? null,
      repo: repoName,
      assignee:
        assigneeName || assigneeLogin
          ? { name: assigneeName ?? '', username: assigneeLogin ?? '' }
          : null,
      labels: (issue.labels ?? []).map((l) => l.name).filter((n): n is string => Boolean(n)),
      updatedAt: issue.updated_at ?? null,
    };
  }

  private getClient(instanceUrl: string, token: string): Client {
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

  private normalizeInstanceUrl(instanceUrl: string): string | null {
    const trimmed = instanceUrl.trim();
    if (!trimmed) return null;

    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return null;
      }
      if (parsed.search || parsed.hash) {
        return null;
      }

      const pathname = parsed.pathname.replace(/\/+$/, '');
      return pathname && pathname !== '/'
        ? `${parsed.protocol}//${parsed.host}${pathname}`
        : `${parsed.protocol}//${parsed.host}`;
    } catch {
      return null;
    }
  }

  private isNotConfigured(error: unknown): boolean {
    return error instanceof Error && error.message === this.NOT_CONFIGURED_ERROR;
  }

  private toErrorMessage(error: unknown, fallback: string): string {
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

    const maybeErr = error as { code?: string };
    if (
      maybeErr?.code &&
      ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN'].includes(maybeErr.code)
    ) {
      return 'Unable to reach Forgejo instance. Check your URL and network connection.';
    }

    if (error instanceof Error && error.message) {
      return error.message;
    }

    return fallback;
  }
}

export const forgejoService = new ForgejoService();
