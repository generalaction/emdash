import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';
import { promisify } from 'util';
import { exec } from 'child_process';
import { log } from '../lib/logger';
import type { ForgejoIssueSummary } from '@shared/forgejo/types';

const execAsync = promisify(exec);

type ForgejoCreds = {
  siteUrl: string;
};

export class ForgejoService {
  private readonly SERVICE_NAME = 'emdash-forgejo';
  private readonly ACCOUNT_NAME = 'forgejo-token';
  private readonly CONF_FILE = join(app.getPath('userData'), 'forgejo.json');

  async saveCredentials(
    instanceUrl: string,
    token: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      instanceUrl = instanceUrl.trim();
      token = token.trim();
      if (instanceUrl.length == 0 || token.length == 0) {
        return { success: false, error: 'Instance URL and token are required' };
      }
      try {
        const parsedUrl = new URL(instanceUrl);
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
          return { success: false, error: 'Invalid URL format' };
        }
      } catch {
        return { success: false, error: 'Invalid URL format' };
      }
      if (instanceUrl[instanceUrl.length - 1] == '/') {
        instanceUrl = instanceUrl.substring(0, instanceUrl.length - 1);
      }

      const keytar = await import('keytar');
      await keytar.setPassword(this.SERVICE_NAME, this.ACCOUNT_NAME, token);
      this.writeCreds({ siteUrl: instanceUrl });
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message };
    }
  }

  async clearCredentials(): Promise<{ success: boolean; error?: string }> {
    try {
      const keytar = await import('keytar');
      await keytar.deletePassword(this.SERVICE_NAME, this.ACCOUNT_NAME);
      if (existsSync(this.CONF_FILE)) {
        unlinkSync(this.CONF_FILE);
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message };
    }
  }

  async checkConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const { siteUrl, token } = await this.requireAuth();
      const user = await this.getUserInfo(siteUrl, token);
      if (!user.success) {
        return { success: false, error: user.error };
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message };
    }
  }

  async initialFetch(
    projectPath?: string,
    limit: number = 10
  ): Promise<{ success: boolean; issues?: ForgejoIssueSummary[]; error?: string }> {
    try {
      const { siteUrl, token } = await this.requireAuth();
      if (!siteUrl || !token) {
        return { success: false, error: 'Forgejo is not configured' };
      }
      if (!projectPath) {
        return { success: false, error: 'Project path is required' };
      }
      const { success, ownerRepo, error } = await this.resolveOwnerRepo(projectPath);
      if (!success || !ownerRepo) {
        return { success: false, error: error };
      }
      const issues = await this.fetchIssues(ownerRepo, limit);
      return { success: true, issues };
    } catch (e: any) {
      return { success: false, error: e?.message };
    }
  }

  async searchIssues(
    projectPath: string | undefined,
    searchTerm: string,
    limit: number = 10
  ): Promise<{ success: boolean; issues?: ForgejoIssueSummary[]; error?: string }> {
    try {
      if (!searchTerm || !searchTerm.trim()) {
        return { success: true, issues: [] };
      }
      const { siteUrl, token } = await this.requireAuth();
      if (!siteUrl || !token) {
        return { success: false, error: 'Forgejo is not configured' };
      }
      if (!projectPath) {
        return { success: false, error: 'Project path is required' };
      }
      const { success, ownerRepo, error } = await this.resolveOwnerRepo(projectPath);
      if (!success || !ownerRepo) {
        return { success: false, error };
      }
      const url = new URL(`${siteUrl}/api/v1/repos/${ownerRepo}/issues`);
      url.searchParams.set('state', 'open');
      url.searchParams.set('type', 'issues');
      url.searchParams.set('q', searchTerm.trim());
      url.searchParams.set('limit', String(limit));
      const response = await this.doRequest(url, token, 'GET');
      if (!response.ok) {
        return { success: false, error: 'Failed to search Forgejo issues' };
      }
      const data = (await response.json()) as any[];
      return { success: true, issues: this.normalizeIssues(data) };
    } catch (e: any) {
      return { success: false, error: e?.message };
    }
  }

  private async resolveOwnerRepo(
    projectPath: string
  ): Promise<{ success: boolean; ownerRepo?: string; error?: string }> {
    try {
      const { siteUrl } = await this.requireAuth();
      const instanceHost = new URL(siteUrl).hostname.toLowerCase();

      const { stdout } = await this.execCmd('git remote get-url origin', { cwd: projectPath });
      const remoteUrl = stdout.trim();
      if (!remoteUrl) {
        return { success: false, error: 'No remote URL found for origin' };
      }

      let remoteHost: string | undefined;
      let slug: string | undefined;

      if (remoteUrl.startsWith('git@')) {
        // SSH: git@forgejo.example.com:owner/repo.git
        const hostMatch = remoteUrl.match(/^git@([^:]+):/);
        if (hostMatch) {
          remoteHost = hostMatch[1].toLowerCase();
        }
        const slugMatch = remoteUrl.match(/:(.*?)(\.git)?$/);
        if (slugMatch && slugMatch[1]) {
          slug = slugMatch[1];
        }
      } else if (remoteUrl.startsWith('https://') || remoteUrl.startsWith('http://')) {
        // HTTPS: https://<host>/owner/repo.git
        const parsed = new URL(remoteUrl);
        remoteHost = parsed.hostname.toLowerCase();
        slug = parsed.pathname.replace(/^\//, '').replace(/\.git$/, '');
      }

      if (remoteHost && remoteHost !== instanceHost) {
        return {
          success: false,
          error: `Git remote host "${remoteHost}" does not match configured Forgejo instance "${instanceHost}". Check your Forgejo settings.`,
        };
      }

      if (!slug) {
        return { success: false, error: 'Unable to extract owner/repo from remote URL' };
      }

      return { success: true, ownerRepo: slug.trim() };
    } catch (e: any) {
      return { success: false, error: 'Unable to resolve repository from remote URL' };
    }
  }

  private async fetchIssues(ownerRepo: string, limit: number = 10): Promise<ForgejoIssueSummary[]> {
    const { siteUrl, token } = await this.requireAuth();
    if (!siteUrl || !token) {
      throw new Error('Forgejo is not configured');
    }
    const url = new URL(`${siteUrl}/api/v1/repos/${ownerRepo}/issues`);
    url.searchParams.set('state', 'open');
    url.searchParams.set('type', 'issues');
    url.searchParams.set('limit', String(limit));
    const response = await this.doRequest(url, token, 'GET');
    if (!response.ok) {
      throw new Error('Could not fetch issues');
    }
    const data = (await response.json()) as any[];
    return this.normalizeIssues(data);
  }

  private normalizeIssues(issues: any[]): ForgejoIssueSummary[] {
    return issues.map((issue) => ({
      id: issue.id,
      number: issue.number,
      title: issue.title,
      description: issue.body ?? null,
      html_url: issue.html_url ?? null,
      state: issue.state ?? null,
      assignee: issue.assignee
        ? { name: issue.assignee.full_name || issue.assignee.login, login: issue.assignee.login }
        : null,
      labels: Array.isArray(issue.labels) ? issue.labels.map((l: any) => l.name) : null,
      updated_at: issue.updated ?? issue.updated_at ?? null,
    }));
  }

  private async execCmd(cmd: string, options?: any): Promise<{ stdout: string; stderr: string }> {
    try {
      const result = await execAsync(cmd, { encoding: 'utf8', ...options });
      return {
        stdout: result.stdout.toString(),
        stderr: result.stderr.toString(),
      };
    } catch (e: any) {
      throw e;
    }
  }

  private async doRequest(
    url: URL,
    token: string,
    method: 'GET' | 'POST',
    payload?: string,
    extraHeaders?: Record<string, string>
  ): Promise<Response> {
    return fetch(url.toString(), {
      method,
      headers: {
        Authorization: `token ${token}`,
        'Content-Type': 'application/json',
        ...(extraHeaders || {}),
      },
      body: method === 'POST' ? payload : undefined,
    });
  }

  private async requireAuth(): Promise<{ siteUrl: string; token: string }> {
    try {
      const creds = this.readCreds();
      if (!creds) {
        throw new Error('Invalid credential files');
      }
      const keytar = await import('keytar');
      const token = await keytar.getPassword(this.SERVICE_NAME, this.ACCOUNT_NAME);
      if (!token) {
        throw new Error('Token not set');
      }
      return { siteUrl: creds.siteUrl, token: token };
    } catch (e: any) {
      throw new Error(e?.message);
    }
  }

  private async getUserInfo(
    siteUrl: string,
    token: string
  ): Promise<{ success: boolean; error?: string; user?: any }> {
    try {
      const url = new URL(`${siteUrl}/api/v1/user`);
      const response = await this.doRequest(url, token, 'GET');
      if (!response.ok) {
        return { success: false, error: 'Failed to get user info' };
      }
      const user = await response.json();
      return { success: true, user };
    } catch (e: any) {
      return { success: false, error: e?.message };
    }
  }

  private writeCreds(creds: ForgejoCreds): void {
    const { siteUrl } = creds;
    const obj: any = { siteUrl };
    writeFileSync(this.CONF_FILE, JSON.stringify(obj), 'utf8');
  }

  private readCreds(): ForgejoCreds | null {
    try {
      if (!existsSync(this.CONF_FILE)) return null;
      const raw = readFileSync(this.CONF_FILE, 'utf8');
      const obj = JSON.parse(raw);
      return { siteUrl: obj.siteUrl };
    } catch (error) {
      log.error('Failed to read Forgejo credentials:', error);
      return null;
    }
  }
}

export const forgejoService = new ForgejoService();
