import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { shell } from 'electron';
import { GITHUB_CONFIG } from '../config/github.config';

const execAsync = promisify(exec);

export interface GitHubUser {
  id: number;
  login: string;
  name: string;
  email: string;
  avatar_url: string;
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  clone_url: string;
  ssh_url: string;
  default_branch: string;
  private: boolean;
  updated_at: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  headRefName: string;
  baseRefName: string;
  url: string;
  isDraft?: boolean;
  updatedAt?: string | null;
  headRefOid?: string;
  author?: {
    login?: string;
    name?: string;
  } | null;
  headRepositoryOwner?: {
    login?: string;
  } | null;
  headRepository?: {
    name?: string;
    nameWithOwner?: string;
    url?: string;
  } | null;
}

export interface AuthResult {
  success: boolean;
  token?: string;
  user?: GitHubUser;
  error?: string;
}

export interface DeviceCodeResult {
  success: boolean;
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  expires_in?: number;
  interval?: number;
  error?: string;
}

export class GitHubService {
  private readonly SERVICE_NAME = 'emdash-github';
  private readonly ACCOUNT_NAME = 'github-token';

  /**
   * Authenticate with GitHub using Device Flow
   * Returns device code info for the UI to display to the user
   */
  async authenticate(): Promise<DeviceCodeResult | AuthResult> {
    return await this.requestDeviceCode();
  }

  /**
   * Request a device code from GitHub for Device Flow authentication
   */
  async requestDeviceCode(): Promise<DeviceCodeResult> {
    try {
      const response = await fetch('https://github.com/login/device/code', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: GITHUB_CONFIG.clientId,
          scope: GITHUB_CONFIG.scopes.join(' '),
        }),
      });

      const data = (await response.json()) as {
        device_code?: string;
        user_code?: string;
        verification_uri?: string;
        expires_in?: number;
        interval?: number;
        error?: string;
        error_description?: string;
      };

      if (data.device_code && data.user_code && data.verification_uri) {
        // Don't auto-open here - let the UI control when to open browser
        return {
          success: true,
          device_code: data.device_code,
          user_code: data.user_code,
          verification_uri: data.verification_uri,
          expires_in: data.expires_in || 900,
          interval: data.interval || 5,
        };
      } else {
        return {
          success: false,
          error: data.error_description || 'Failed to request device code',
        };
      }
    } catch (error) {
      console.error('Device code request failed:', error);
      return {
        success: false,
        error: 'Network error while requesting device code',
      };
    }
  }

  /**
   * Poll for access token using device code
   * Should be called repeatedly until success or error
   */
  async pollDeviceToken(deviceCode: string, interval: number = 5): Promise<AuthResult> {
    try {
      const response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: GITHUB_CONFIG.clientId,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      });

      const data = (await response.json()) as {
        access_token?: string;
        token_type?: string;
        scope?: string;
        error?: string;
        error_description?: string;
      };

      if (data.access_token) {
        // Store token securely
        await this.storeToken(data.access_token);

        // Authenticate gh CLI with the token
        await this.authenticateGHCLI(data.access_token);

        // Get user info
        const user = await this.getUserInfo(data.access_token);

        return {
          success: true,
          token: data.access_token,
          user: user || undefined,
        };
      } else if (data.error) {
        // Return error to caller - they decide how to handle
        return {
          success: false,
          error: data.error,
        };
      } else {
        return {
          success: false,
          error: 'Unknown error during token polling',
        };
      }
    } catch (error) {
      console.error('Token polling failed:', error);
      return {
        success: false,
        error: 'Network error during token polling',
      };
    }
  }

  /**
   * Authenticate gh CLI with the OAuth token
   */
  private async authenticateGHCLI(token: string): Promise<void> {
      try {
      // Check if gh CLI is installed first
        await execAsync('gh --version');

      // Authenticate gh CLI with our token
      await execAsync(`echo "${token}" | gh auth login --with-token`);
      console.log('Successfully authenticated gh CLI');
    } catch (error) {
      console.warn('Could not authenticate gh CLI (may not be installed):', error);
      // Don't throw - OAuth still succeeded even if gh CLI isn't available
    }
  }

  /**
   * Execute gh command with automatic re-auth on failure
   */
  private async execGH(
    command: string,
    options?: any
  ): Promise<{ stdout: string; stderr: string }> {
    try {
      const result = await execAsync(command, { encoding: 'utf8', ...options });
        return {
        stdout: String(result.stdout),
        stderr: String(result.stderr),
      };
    } catch (error: any) {
      // Check if it's an auth error
      if (error.message && error.message.includes('not authenticated')) {
        console.log('gh CLI lost authentication, re-authenticating...');

        // Try to re-authenticate gh CLI with stored token
        const token = await this.getStoredToken();
        if (token) {
          await this.authenticateGHCLI(token);

          // Retry the command
          const result = await execAsync(command, { encoding: 'utf8', ...options });
        return {
            stdout: String(result.stdout),
            stderr: String(result.stderr),
        };
        }
      }
      throw error;
    }
  }

  /**
   * List open GitHub issues for the current repo (cwd = projectPath)
   */
  async listIssues(
    projectPath: string,
    limit: number = 50
  ): Promise<
    Array<{
      number: number;
      title: string;
      url?: string;
      state?: string;
      updatedAt?: string | null;
      assignees?: Array<{ login?: string; name?: string }>;
      labels?: Array<{ name?: string }>;
    }>
  > {
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    try {
      const fields = ['number', 'title', 'url', 'state', 'updatedAt', 'assignees', 'labels'];
      const { stdout } = await this.execGH(
        `gh issue list --state open --limit ${safeLimit} --json ${fields.join(',')}`,
        { cwd: projectPath }
      );
      const list = JSON.parse(stdout || '[]');
      if (!Array.isArray(list)) return [];
      return list;
    } catch (error) {
      console.error('Failed to list GitHub issues:', error);
      throw error;
    }
  }

  /** Search open issues in current repo */
  async searchIssues(
    projectPath: string,
    searchTerm: string,
    limit: number = 20
  ): Promise<
    Array<{
      number: number;
      title: string;
      url?: string;
      state?: string;
      updatedAt?: string | null;
      assignees?: Array<{ login?: string; name?: string }>;
      labels?: Array<{ name?: string }>;
    }>
  > {
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 200);
    const term = String(searchTerm || '').trim();
    if (!term) return [];
    try {
      const fields = ['number', 'title', 'url', 'state', 'updatedAt', 'assignees', 'labels'];
      const { stdout } = await this.execGH(
        `gh issue list --state open --search ${JSON.stringify(term)} --limit ${safeLimit} --json ${fields.join(',')}`,
        { cwd: projectPath }
      );
      const list = JSON.parse(stdout || '[]');
      if (!Array.isArray(list)) return [];
      return list;
    } catch (error) {
      // Surface empty results rather than failing hard on weird queries
      return [];
    }
  }

  /** Get a single issue with body for enrichment */
  async getIssue(
    projectPath: string,
    number: number
  ): Promise<{
    number: number;
    title?: string;
    body?: string;
    url?: string;
    state?: string;
    updatedAt?: string | null;
    assignees?: Array<{ login?: string; name?: string }>;
    labels?: Array<{ name?: string }>;
  } | null> {
    try {
      const fields = [
        'number',
        'title',
        'body',
        'url',
        'state',
        'updatedAt',
        'assignees',
        'labels',
      ];
      const { stdout } = await this.execGH(
        `gh issue view ${JSON.stringify(String(number))} --json ${fields.join(',')}`,
        { cwd: projectPath }
      );
      const data = JSON.parse(stdout || 'null');
      if (!data || typeof data !== 'object') return null;
      return data;
    } catch (error) {
      console.error('Failed to view GitHub issue:', error);
      return null;
    }
  }

  /**
   * Authenticate with GitHub using Personal Access Token
   */
  async authenticateWithToken(token: string): Promise<AuthResult> {
    try {
      // Test the token by getting user info
      const user = await this.getUserInfo(token);

      if (user) {
        // Store token securely
        await this.storeToken(token);
        return { success: true, token, user };
      }

      return { success: false, error: 'Invalid token' };
    } catch (error) {
      console.error('Token authentication failed:', error);
      return {
        success: false,
        error: 'Invalid token or network error',
      };
    }
  }

  /**
   * Check if user is authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    try {
      const token = await this.getStoredToken();

      if (!token) {
        // No stored token, user needs to authenticate
        return false;
      }

      // Test the token by making a simple API call
      const user = await this.getUserInfo(token);
      return !!user;
    } catch (error) {
      console.error('Authentication check failed:', error);
      return false;
    }
  }

  /**
   * Get user information using GitHub CLI
   */
  async getUserInfo(token: string): Promise<GitHubUser | null> {
    try {
      // Use gh CLI to get user info
      const { stdout } = await this.execGH('gh api user');
      const userData = JSON.parse(stdout);

      return {
        id: userData.id,
        login: userData.login,
        name: userData.name || userData.login,
        email: userData.email || '',
        avatar_url: userData.avatar_url,
      };
    } catch (error) {
      console.error('Failed to get user info:', error);
      return null;
    }
  }

  /**
   * Get user's repositories using GitHub CLI
   */
  async getRepositories(token: string): Promise<GitHubRepo[]> {
    try {
      // Use gh CLI to get repositories with correct field names
      const { stdout } = await this.execGH(
        'gh repo list --limit 100 --json name,nameWithOwner,description,url,defaultBranchRef,isPrivate,updatedAt,primaryLanguage,stargazerCount,forkCount'
      );
      const repos = JSON.parse(stdout);

      return repos.map((repo: any) => ({
        id: Math.random(), // gh CLI doesn't provide ID, so we generate one
        name: repo.name,
        full_name: repo.nameWithOwner,
        description: repo.description,
        html_url: repo.url,
        clone_url: `https://github.com/${repo.nameWithOwner}.git`,
        ssh_url: `git@github.com:${repo.nameWithOwner}.git`,
        default_branch: repo.defaultBranchRef?.name || 'main',
        private: repo.isPrivate,
        updated_at: repo.updatedAt,
        language: repo.primaryLanguage?.name || null,
        stargazers_count: repo.stargazerCount || 0,
        forks_count: repo.forkCount || 0,
      }));
    } catch (error) {
      console.error('Failed to fetch repositories:', error);
      throw error;
    }
  }

  /**
   * List open pull requests for the repository located at projectPath.
   */
  async getPullRequests(projectPath: string): Promise<GitHubPullRequest[]> {
    try {
      const fields = [
        'number',
        'title',
        'headRefName',
        'baseRefName',
        'url',
        'isDraft',
        'updatedAt',
        'headRefOid',
        'author',
        'headRepositoryOwner',
        'headRepository',
      ];
      const { stdout } = await this.execGH(`gh pr list --state open --json ${fields.join(',')}`, {
        cwd: projectPath,
      });
      const list = JSON.parse(stdout || '[]');

      if (!Array.isArray(list)) return [];

      return list.map((item: any) => ({
        number: item?.number,
        title: item?.title || `PR #${item?.number ?? 'unknown'}`,
        headRefName: item?.headRefName || '',
        baseRefName: item?.baseRefName || '',
        url: item?.url || '',
        isDraft: item?.isDraft ?? false,
        updatedAt: item?.updatedAt || null,
        headRefOid: item?.headRefOid || undefined,
        author: item?.author || null,
        headRepositoryOwner: item?.headRepositoryOwner || null,
        headRepository: item?.headRepository || null,
      }));
    } catch (error) {
      console.error('Failed to list pull requests:', error);
      throw error;
    }
  }

  /**
   * Ensure a local branch exists for the given pull request by delegating to gh CLI.
   * Returns the branch name that now tracks the PR.
   */
  async ensurePullRequestBranch(
    projectPath: string,
    prNumber: number,
    branchName: string
  ): Promise<string> {
    const safeBranch = branchName || `pr/${prNumber}`;
    let previousRef: string | null = null;

    try {
      const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', {
        cwd: projectPath,
      });
      const current = (stdout || '').trim();
      if (current) previousRef = current;
    } catch {
      previousRef = null;
    }

    try {
      await this.execGH(
        `gh pr checkout ${JSON.stringify(String(prNumber))} --branch ${JSON.stringify(safeBranch)} --force`,
        { cwd: projectPath }
      );
    } catch (error) {
      console.error('Failed to checkout pull request branch via gh:', error);
      throw error;
    } finally {
      if (previousRef && previousRef !== safeBranch) {
        try {
          await execAsync(`git checkout ${JSON.stringify(previousRef)}`, { cwd: projectPath });
        } catch (switchErr) {
          console.warn('Failed to restore previous branch after PR checkout:', switchErr);
        }
      }
    }

    return safeBranch;
  }

  /**
   * Clone a repository to local workspace
   */
  async cloneRepository(
    repoUrl: string,
    localPath: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Ensure the local path directory exists
      const dir = path.dirname(localPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Clone the repository
      await execAsync(`git clone "${repoUrl}" "${localPath}"`);

      return { success: true };
    } catch (error) {
      console.error('Failed to clone repository:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Clone failed',
      };
    }
  }

  /**
   * Logout and clear stored token
   */
  async logout(): Promise<void> {
    try {
      const keytar = await import('keytar');
      await keytar.deletePassword(this.SERVICE_NAME, this.ACCOUNT_NAME);
    } catch (error) {
      console.error('Failed to logout:', error);
    }
  }

  /**
   * Store authentication token securely
   */
  private async storeToken(token: string): Promise<void> {
    try {
      const keytar = await import('keytar');
      await keytar.setPassword(this.SERVICE_NAME, this.ACCOUNT_NAME, token);
    } catch (error) {
      console.error('Failed to store token:', error);
      throw error;
    }
  }

  /**
   * Retrieve stored authentication token
   */
  private async getStoredToken(): Promise<string | null> {
    try {
      const keytar = await import('keytar');
      return await keytar.getPassword(this.SERVICE_NAME, this.ACCOUNT_NAME);
    } catch (error) {
      console.error('Failed to retrieve token:', error);
      return null;
    }
  }
}
