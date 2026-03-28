import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

interface GitLabIssueSummary {
  id: number;
  iid: number; // project-scoped issue number
  title: string;
  description?: string | null;
  web_url?: string | null;
  state?: string | null; // "opened" | "closed"
  project?: { name: string } | null;
  assignee?: { name: string; username: string } | null;
  labels?: string[] | null;
  updated_at?: string | null;
}

interface GitLabMRSummary {
  id: number;
  iid: number; // project-scoped MR number
  title: string;
  web_url?: string | null;
  state?: string | null; // "opened" | "closed" | "merged" | "locked"
  source_branch?: string | null;
  target_branch?: string | null;
  assignee?: { name: string; username: string } | null;
  labels?: string[] | null;
  updated_at?: string | null;
}

type GitLabCreds = {
  siteUrl: string;
};

export class GitLabService {
  private readonly SERVICE_NAME = 'emdash-gitlab';
  private readonly ACCOUNT_NAME = 'gitlab-token';
  private readonly CONF_FILE = join(app.getPath('userData'), 'gitlab.json');

  async saveCredentials(
    siteUrl: string,
    token: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      siteUrl = siteUrl.trim();
      token = token.trim();
      if (siteUrl.length == 0 || token.length == 0) {
        return { success: false, error: 'Instance URL and token are required' };
      }
      const regex = /^https?:\/\/([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(:\d{1,5})?\/?$/;
      if (!regex.test(siteUrl)) {
        return { success: false, error: 'Invalid URL format' };
      }
      if (siteUrl[siteUrl.length - 1] == '/') {
        siteUrl = siteUrl.substring(0, siteUrl.length - 1);
      }

      const keytar = await import('keytar');
      await keytar.setPassword(this.SERVICE_NAME, this.ACCOUNT_NAME, token);
      this.writeCreds({ siteUrl: siteUrl });
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
  ): Promise<{ success: boolean; issues?: GitLabIssueSummary[]; error?: string }> {
    try {
      const { siteUrl, token } = await this.requireAuth();
      if (!siteUrl || !token) {
        return { success: false, error: 'Gitlab is not configured' };
      }
      if (!projectPath) {
        return { success: false, error: 'Project path is required' };
      }
      const { success, id, error } = await this.resolveProjectId(projectPath);
      if (!success) {
        return { success: false, error: error };
      }
      if (!id) {
        return { success: false, error: 'Unable to resolve project ID' };
      }
      const issues = await this.fetchIssues(id, limit);
      return { success: true, issues: issues };
    } catch (e: any) {
      return { success: false, error: e?.message };
    }
  }

  async initialFetchMRs(
    projectPath?: string,
    limit: number = 10
  ): Promise<{ success: boolean; mrs?: GitLabMRSummary[]; error?: string }> {
    try {
      const path = projectPath?.trim();
      const clampedLimit = Math.max(1, Math.min(typeof limit === 'number' ? limit : 10, 100));
      const { siteUrl, token } = await this.requireAuth();
      if (!siteUrl || !token) {
        return { success: false, error: 'GitLab is not configured' };
      }
      if (!path) {
        return { success: false, error: 'Project path is required' };
      }
      const { success, id, error } = await this.resolveProjectId(path);
      if (!success) {
        return { success: false, error };
      }
      if (!id) {
        return { success: false, error: 'Unable to resolve project ID' };
      }
      const mrs = await this.fetchMergeRequests(id, clampedLimit);
      return { success: true, mrs };
    } catch (e: any) {
      return { success: false, error: e?.message };
    }
  }

  async searchIssues(
    projectPath: string | undefined,
    searchTerm: string,
    limit: number = 10
  ): Promise<{ success: boolean; issues?: GitLabIssueSummary[]; error?: string }> {
    try {
      if (!searchTerm || !searchTerm.trim()) {
        return { success: true, issues: [] };
      }
      const { siteUrl, token } = await this.requireAuth();
      if (!siteUrl || !token) {
        return { success: false, error: 'GitLab is not configured' };
      }
      if (!projectPath) {
        return { success: false, error: 'Project path is required' };
      }
      const { success, id, error } = await this.resolveProjectId(projectPath);
      if (!success) {
        return { success: false, error };
      }
      if (!id) {
        return { success: false, error: 'Unable to resolve project ID' };
      }
      const url = new URL(`${siteUrl}/api/v4/projects/${encodeURIComponent(id)}/issues`);
      url.searchParams.set('search', searchTerm.trim());
      url.searchParams.set('in', 'title,description');
      url.searchParams.set('per_page', String(limit));
      url.searchParams.set('order_by', 'updated_at');
      url.searchParams.set('sort', 'desc');
      const response = await this.doRequest(url, token, 'GET');
      if (!response.ok) {
        return { success: false, error: 'Failed to search GitLab issues' };
      }
      const data = (await response.json()) as any[];
      return { success: true, issues: this.normalizeIssues(data) };
    } catch (e: any) {
      return { success: false, error: e?.message };
    }
  }

  private async resolveProjectId(
    projectPath: string
  ): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const { siteUrl } = await this.requireAuth();
      const instanceHost = new URL(siteUrl).hostname.toLowerCase();

      const { stdout } = await this.execCmd('git remote get-url origin', {
        cwd: projectPath,
      });
      const remoteUrl = stdout.trim();
      if (!remoteUrl) {
        return { success: false, error: 'No remote URL found for origin' };
      }

      let remoteHost: string | undefined;
      let slug: string | undefined;

      if (remoteUrl.startsWith('git@')) {
        // SSH: git@gitlab.com:group/subgroup/project.git
        const hostMatch = remoteUrl.match(/^git@([^:]+):/);
        if (hostMatch) {
          remoteHost = hostMatch[1].toLowerCase();
        }
        const slugMatch = remoteUrl.match(/:(.*?)(\.git)?$/);
        if (slugMatch && slugMatch[1]) {
          slug = slugMatch[1];
        }
      } else if (remoteUrl.startsWith('https://') || remoteUrl.startsWith('http://')) {
        // HTTPS: https://<host>/group/subgroup/project.git
        const parsed = new URL(remoteUrl);
        remoteHost = parsed.hostname.toLowerCase();
        slug = parsed.pathname.replace(/^\//, '').replace(/\.git$/, '');
      }

      if (remoteHost && remoteHost !== instanceHost) {
        return {
          success: false,
          error: `Git remote host "${remoteHost}" does not match configured GitLab instance "${instanceHost}". Check your GitLab settings or configure a project path override.`,
        };
      }

      if (!slug) {
        return { success: false, error: 'Unable to extract GitLab project slug from remote URL' };
      }
      slug = encodeURIComponent(slug.trim());
      const { id } = await this.getProjectId(slug);
      return { success: true, id: id };
    } catch (e: any) {
      return { success: false, error: 'Unable to resolve project ID' };
    }
  }

  private async fetchIssues(projectId: string, limit: number = 10): Promise<any[]> {
    try {
      const { siteUrl, token } = await this.requireAuth();
      if (!siteUrl || !token) {
        throw new Error('Gitlab is not configured');
      }
      const url = new URL(
        `${siteUrl}/api/v4/projects/${projectId}/issues?state=opened&order_by=updated_at&sort=desc&per_page=${limit}`
      );
      const response = await this.doRequest(url, token, 'GET');
      if (!response.ok) {
        throw new Error('could not fetch issues');
      }
      const data = (await response.json()) as any[];
      return this.normalizeIssues(data);
    } catch (e: any) {
      throw e;
    }
  }

  private async fetchMergeRequests(
    projectId: string,
    limit: number = 10
  ): Promise<GitLabMRSummary[]> {
    const { siteUrl, token } = await this.requireAuth();
    if (!siteUrl || !token) {
      throw new Error('GitLab is not configured');
    }
    const url = new URL(
      `${siteUrl}/api/v4/projects/${projectId}/merge_requests?state=opened&order_by=updated_at&sort=desc&per_page=${limit}`
    );
    const response = await this.doRequest(url, token, 'GET');
    if (!response.ok) {
      throw new Error('Could not fetch merge requests');
    }
    const data = (await response.json()) as any[];
    return data.map((mr) => ({
      id: mr.id,
      iid: mr.iid,
      title: mr.title,
      web_url: mr.web_url,
      state: mr.state,
      source_branch: mr.source_branch,
      target_branch: mr.target_branch,
      assignee: mr.assignee ?? (Array.isArray(mr.assignees) ? (mr.assignees[0] ?? null) : null),
      labels: mr.labels,
      updated_at: mr.updated_at,
    }));
  }

  private normalizeIssues(issues: any[]): GitLabIssueSummary[] {
    return issues.map((issue) => ({
      id: issue.id,
      iid: issue.iid,
      title: issue.title,
      description: issue.description,
      web_url: issue.web_url,
      state: issue.state,
      project: issue.project,
      assignee: issue.assignee,
      labels: issue.labels,
      updated_at: issue.updated_at,
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

  private async getProjectId(projectSlug: string): Promise<{ id: string }> {
    try {
      const { siteUrl, token } = await this.requireAuth();
      const url = new URL(`${siteUrl}/api/v4/projects/${projectSlug}`);
      const res = await this.doRequest(url, token, 'GET');
      if (!res.ok) {
        throw new Error('Failed to fetch project Id');
      }
      const data: any = await res.json();
      if (!data['id']) {
        throw new Error('Error while retriving the Id');
      }
      return { id: data['id'] };
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
        'PRIVATE-TOKEN': token,
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
        throw new Error('Token does not set');
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
      const url = new URL(`${siteUrl}/api/v4/user`);
      const response = await this.doRequest(url, token, 'GET');
      if (!response.ok) {
        return { success: false, error: 'Failed to get user info' };
      }
      const user = await response.json();
      return { success: true, user: user };
    } catch (e: any) {
      return { success: false, error: e?.message };
    }
  }

  private writeCreds(creds: GitLabCreds) {
    try {
      const { siteUrl } = creds;
      const obj: any = { siteUrl };
      writeFileSync(this.CONF_FILE, JSON.stringify(obj), 'utf8');
    } catch (error) {
      console.error('Failed to write GitLab credentials:', error);
    }
  }

  private readCreds(): GitLabCreds | null {
    try {
      if (!existsSync(this.CONF_FILE)) return null;
      const raw = readFileSync(this.CONF_FILE, 'utf8');
      const obj = JSON.parse(raw);
      return { siteUrl: obj.siteUrl };
    } catch (error) {
      console.error('Failed to read GitLab credentials:', error);
      return null;
    }
  }
}

export const gitlabService = new GitLabService();
