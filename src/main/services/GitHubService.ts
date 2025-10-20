import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';

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

export class GitHubService {
  private readonly SERVICE_NAME = 'emdash-github';
  private readonly ACCOUNT_NAME = 'github-token';

  /**
   * Authenticate with GitHub using GitHub CLI (gh)
   */
  async authenticate(): Promise<AuthResult> {
    try {
      // Check if gh CLI is installed and authenticated
      const { stdout } = await execAsync('gh auth status');

      if (stdout.includes('Logged in')) {
        // Get token from gh CLI
        const { stdout: token } = await execAsync('gh auth token');
        const cleanToken = token.trim();

        if (cleanToken) {
          // Store token securely
          await this.storeToken(cleanToken);

          // Get user info
          const user = await this.getUserInfo(cleanToken);

          return { success: true, token: cleanToken, user: user || undefined };
        }
      }

      return {
        success: false,
        error:
          'GitHub CLI not authenticated.\n\nTo fix this:\n1. Open your terminal\n2. Run: gh auth login\n3. Follow the authentication steps\n4. Try again in orchbench',
      };
    } catch (error) {
      console.error('GitHub authentication failed:', error);

      // Check if gh CLI is installed
      try {
        await execAsync('gh --version');
        return {
          success: false,
          error:
            'GitHub CLI not authenticated.\n\nTo fix this:\n1. Open your terminal\n2. Run: gh auth login\n3. Follow the authentication steps\n4. Try again in orchbench',
        };
      } catch {
        return {
          success: false,
          error:
            'GitHub CLI not installed.\n\nTo install GitHub CLI:\n\nOn macOS:\nbrew install gh\n\nOn Linux:\nsudo apt install gh\n\nOn Windows:\nwinget install GitHub.cli\n\nAfter installation, run: gh auth login',
        };
      }
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
      let token = await this.getStoredToken();

      if (!token) {
        const authResult = await this.authenticate();
        if (!authResult.success || !authResult.token) {
          return false;
        }
        token = authResult.token;
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
      const { stdout } = await execAsync('gh api user');
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
      const { stdout } = await execAsync(
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
      const { stdout } = await execAsync(`gh pr list --state open --json ${fields.join(',')}`, {
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
      await execAsync(
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

  /**
   * Fetch initial list of GitHub issues for a project
   */
  async getIssues(projectPath: string, limit = 50): Promise<any[]> {
    try {
      const sanitizedLimit = Math.min(Math.max(limit, 1), 200);

      const fields = [
        'number',
        'title',
        'body',
        'url',
        'state',
        'labels',
        'assignees',
        'milestone',
        'updatedAt',
      ];

      const { stdout } = await execAsync(
        `gh issue list --state open --limit ${sanitizedLimit} --json ${fields.join(',')}`,
        { cwd: projectPath }
      );

      const issues = JSON.parse(stdout || '[]');

      if (!Array.isArray(issues)) return [];

      return issues.map((issue: any) => ({
        id: issue.number,
        number: issue.number,
        title: issue.title || `Issue #${issue.number}`,
        body: issue.body || null,
        url: issue.url || null,
        state: issue.state || 'open',
        labels: issue.labels || [],
        assignee: issue.assignees?.[0] || null,
        assignees: issue.assignees || [],
        milestone: issue.milestone || null,
        updatedAt: issue.updatedAt || null,
      }));
    } catch (error) {
      console.error('Failed to fetch GitHub issues:', error);
      throw error;
    }
  }

  /**
   * Search GitHub issues by query string
   */
  async searchIssues(projectPath: string, searchTerm: string, limit = 20): Promise<any[]> {
    try {
      if (!searchTerm.trim()) {
        return [];
      }

      const sanitizedLimit = Math.min(Math.max(limit, 1), 200);

      const fields = [
        'number',
        'title',
        'body',
        'url',
        'state',
        'labels',
        'assignees',
        'milestone',
        'updatedAt',
      ];

      // Get all open issues and filter locally
      const { stdout } = await execAsync(
        `gh issue list --state open --limit 100 --json ${fields.join(',')}`,
        { cwd: projectPath }
      );

      const allIssues = JSON.parse(stdout || '[]');

      if (!Array.isArray(allIssues)) return [];

      // Filter locally by search term
      const searchTermLower = searchTerm.trim().toLowerCase();
      const filteredIssues = allIssues.filter((issue: any) => {
        // Search in issue number
        if (String(issue.number).includes(searchTerm)) {
          return true;
        }
        // Search in title
        if (issue.title?.toLowerCase().includes(searchTermLower)) {
          return true;
        }
        // Search in assignee login
        if (issue.assignees?.some((a: any) => a.login?.toLowerCase().includes(searchTermLower))) {
          return true;
        }
        // Search in labels
        if (issue.labels?.some((l: any) => l.name?.toLowerCase().includes(searchTermLower))) {
          return true;
        }
        return false;
      });

      return filteredIssues.slice(0, sanitizedLimit).map((issue: any) => ({
        id: issue.number,
        number: issue.number,
        title: issue.title || `Issue #${issue.number}`,
        body: issue.body || null,
        url: issue.url || null,
        state: issue.state || 'open',
        labels: issue.labels || [],
        assignee: issue.assignees?.[0] || null,
        assignees: issue.assignees || [],
        milestone: issue.milestone || null,
        updatedAt: issue.updatedAt || null,
      }));
    } catch (error) {
      console.error('Failed to search GitHub issues:', error);
      return [];
    }
  }
}
