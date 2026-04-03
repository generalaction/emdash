import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GitbeakerRequestError, Gitlab } from '@gitbeaker/rest';
import keytar from 'keytar';
import type { Issue } from '@shared/tasks';
import { KV } from '@main/db/kv';

const execFileAsync = promisify(execFile);

interface GitLabConnectionConfig {
  instanceUrl: string;
}

interface GitLabKVSchema extends Record<string, unknown> {
  connection: GitLabConnectionConfig;
}

export interface GitLabConnectionStatus {
  connected: boolean;
  username?: string;
  displayName?: string;
  instanceUrl?: string;
  error?: string;
}

export interface GitLabIssueSummary {
  id: number;
  iid: number;
  title: string;
  description: string | null;
  webUrl: string | null;
  state: string | null;
  project: { name: string } | null;
  assignee: { name: string; username: string } | null;
  labels: string[];
  updatedAt: string | null;
}

export function toGeneralIssue(issue: GitLabIssueSummary): Issue {
  return {
    provider: 'gitlab',
    identifier: `#${issue.iid}`,
    title: issue.title,
    url: issue.webUrl ?? '',
    description: issue.description ?? undefined,
    status: issue.state ?? undefined,
    assignees: issue.assignee
      ? [issue.assignee.name || issue.assignee.username].filter(Boolean)
      : undefined,
    project: issue.project?.name ?? undefined,
    updatedAt: issue.updatedAt ?? undefined,
  };
}

const gitlabKV = new KV<GitLabKVSchema>('gitlab');

export class GitlabService {
  private readonly SERVICE_NAME = 'emdash-gitlab';
  private readonly ACCOUNT_NAME = 'api-token';
  private readonly NOT_CONFIGURED_ERROR = 'GitLab is not configured. Connect GitLab in settings.';

  private client: Gitlab | null = null;
  private clientKey: string | null = null;

  async saveCredentials(
    instanceUrl: string,
    token: string
  ): Promise<{ success: boolean; username?: string; displayName?: string; error?: string }> {
    const normalizedUrl = this.normalizeInstanceUrl(instanceUrl);
    if (!normalizedUrl) {
      return { success: false, error: 'A valid GitLab instance URL is required.' };
    }

    const cleanToken = token.trim();
    if (!cleanToken) {
      return { success: false, error: 'A GitLab API token is required.' };
    }

    try {
      const client = this.getClient(normalizedUrl, cleanToken);
      const user = (await client.Users.showCurrentUser()) as Record<string, unknown>;

      await keytar.setPassword(this.SERVICE_NAME, this.ACCOUNT_NAME, cleanToken);
      await this.writeConnection({ instanceUrl: normalizedUrl });

      const username = this.readString(user.username) ?? undefined;
      const displayName = this.readString(user.name) ?? username;

      return { success: true, username, displayName };
    } catch (error) {
      return {
        success: false,
        error: this.toErrorMessage(error, 'Failed to validate GitLab credentials.'),
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
        error: this.toErrorMessage(error, 'Failed to clear GitLab credentials.'),
      };
    }
  }

  async checkConnection(): Promise<GitLabConnectionStatus> {
    try {
      const { instanceUrl, client } = await this.requireAuth();
      const user = (await client.Users.showCurrentUser()) as Record<string, unknown>;

      const username = this.readString(user.username) ?? undefined;
      const displayName = this.readString(user.name) ?? username;

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
        error: this.toErrorMessage(error, 'Failed to verify GitLab connection.'),
      };
    }
  }

  async initialFetch(projectPath: string, limit = 50): Promise<GitLabIssueSummary[]> {
    const path = projectPath.trim();
    if (!path) {
      throw new Error('Project path is required.');
    }

    const perPage = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 100)) : 50;
    const { client, projectId, projectName } = await this.resolveProject(path);

    try {
      const issues = (await client.Issues.all({
        projectId,
        state: 'opened',
        orderBy: 'updated_at',
        sort: 'desc',
        perPage,
      })) as unknown[];

      return this.normalizeIssues(issues, projectName);
    } catch (error) {
      throw new Error(this.toErrorMessage(error, 'Failed to fetch GitLab issues.'));
    }
  }

  async searchIssues(
    projectPath: string,
    searchTerm: string,
    limit = 20
  ): Promise<GitLabIssueSummary[]> {
    const path = projectPath.trim();
    if (!path) {
      throw new Error('Project path is required.');
    }

    const term = searchTerm.trim();
    if (!term) return [];

    const perPage = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 100)) : 20;
    const { client, projectId, projectName } = await this.resolveProject(path);

    try {
      const issues = (await client.Issues.all({
        projectId,
        state: 'opened',
        search: term,
        in: 'title,description',
        orderBy: 'updated_at',
        sort: 'desc',
        perPage,
      })) as unknown[];

      return this.normalizeIssues(issues, projectName);
    } catch (error) {
      throw new Error(this.toErrorMessage(error, 'Failed to search GitLab issues.'));
    }
  }

  private async requireAuth(): Promise<{ instanceUrl: string; token: string; client: Gitlab }> {
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
      token,
      client: this.getClient(connection.instanceUrl, token),
    };
  }

  private async resolveProject(
    projectPath: string
  ): Promise<{ client: Gitlab; projectId: number; projectName: string | null }> {
    const { instanceUrl, client } = await this.requireAuth();
    const remoteUrl = await this.getOriginRemoteUrl(projectPath);
    const remote = this.parseRemoteUrl(remoteUrl);
    if (!remote) {
      throw new Error('Unable to parse git remote URL from origin.');
    }

    const instanceHost = new URL(instanceUrl).hostname.toLowerCase();
    if (remote.host !== instanceHost) {
      throw new Error(
        `Git remote host "${remote.host}" does not match configured GitLab instance "${instanceHost}".`
      );
    }

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
      throw new Error(this.toErrorMessage(error, 'Unable to resolve GitLab project from origin.'));
    }
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

  private normalizeIssues(rawIssues: unknown[], projectName: string | null): GitLabIssueSummary[] {
    const issues = Array.isArray(rawIssues) ? rawIssues : [];
    return issues
      .map((item) => this.mapIssue(item, projectName))
      .filter((issue): issue is GitLabIssueSummary => issue !== null);
  }

  private mapIssue(raw: unknown, projectName: string | null): GitLabIssueSummary | null {
    const item = this.asRecord(raw);
    if (!item) return null;

    const id = this.readNumber(item.id);
    const iid = this.readNumber(item.iid);
    if (id === null || iid === null) return null;

    const title = this.readString(item.title) ?? '';
    const description = this.readString(item.description);
    const webUrl = this.readString(item.web_url) ?? this.readString(item.webUrl);
    const state = this.readString(item.state);
    const updatedAt = this.readString(item.updated_at) ?? this.readString(item.updatedAt);

    const assigneeRecord =
      this.asRecord(item.assignee) ??
      (Array.isArray(item.assignees) ? this.asRecord(item.assignees[0]) : null);
    const assigneeName =
      this.readString(assigneeRecord?.name) ?? this.readString(assigneeRecord?.username);
    const assigneeUsername =
      this.readString(assigneeRecord?.username) ?? this.readString(assigneeRecord?.name);
    const assignee =
      assigneeName || assigneeUsername
        ? {
            name: assigneeName ?? assigneeUsername ?? '',
            username: assigneeUsername ?? assigneeName ?? '',
          }
        : null;

    const labels = Array.isArray(item.labels)
      ? item.labels
          .map((label) => {
            if (typeof label === 'string') return label;
            const labelObj = this.asRecord(label);
            return this.readString(labelObj?.name);
          })
          .filter((label): label is string => Boolean(label))
      : [];

    return {
      id,
      iid,
      title,
      description,
      webUrl,
      state,
      project: projectName ? { name: projectName } : null,
      assignee,
      labels,
      updatedAt,
    };
  }

  private getClient(instanceUrl: string, token: string): Gitlab {
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

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  }

  private isNotConfigured(error: unknown): boolean {
    return error instanceof Error && error.message === this.NOT_CONFIGURED_ERROR;
  }

  private toErrorMessage(error: unknown, fallback: string): string {
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

    const maybeErr = error as { code?: string };
    if (
      maybeErr?.code &&
      ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN'].includes(maybeErr.code)
    ) {
      return 'Unable to reach GitLab instance. Check your URL and network connection.';
    }

    if (error instanceof Error && error.message) {
      return error.message;
    }

    return fallback;
  }
}

export const gitlabService = new GitlabService();
