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

export interface AuthResult {
  success: boolean;
  token?: string;
  user?: GitHubUser;
  error?: string;
}

export class GitHubService {
  private readonly SERVICE_NAME = 'emdash-github';
  private readonly ACCOUNT_NAME = 'github-token';
  private readonly GH_PATH = '/opt/homebrew/bin/gh';
  private readonly GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

  /**
   * Authenticate with GitHub using GitHub CLI (gh)
   */
  async authenticate(): Promise<AuthResult> {
    try {
      // Check if gh CLI is installed and authenticated
      const { stdout } = await execAsync(`${this.GH_PATH} auth status`);
      
      if (stdout.includes('Logged in')) {
        // Get token from gh CLI
        const { stdout: token } = await execAsync(`${this.GH_PATH} auth token`);
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
        error: 'GitHub CLI not authenticated.\n\nTo fix this:\n1. Open your terminal\n2. Run: gh auth login\n3. Follow the authentication steps\n4. Try again in orchbench' 
      };
    } catch (error) {
      console.error('GitHub authentication failed:', error);
      
      // Check if gh CLI is installed
      try {
        await execAsync(`${this.GH_PATH} --version`);
        return { 
          success: false, 
          error: 'GitHub CLI not authenticated.\n\nTo fix this:\n1. Open your terminal\n2. Run: gh auth login\n3. Follow the authentication steps\n4. Try again in orchbench' 
        };
      } catch {
        return { 
          success: false, 
          error: 'GitHub CLI not installed.\n\nTo install GitHub CLI:\n\nOn macOS:\nbrew install gh\n\nOn Linux:\nsudo apt install gh\n\nOn Windows:\nwinget install GitHub.cli\n\nAfter installation, run: gh auth login' 
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
        error: 'Invalid token or network error' 
      };
    }
  }

  /**
   * Check if user is authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    try {
      // Use direct GitHub API call with token
      const user = await this.getUserInfo(this.GITHUB_TOKEN);
      return !!user;
    } catch (error) {
      console.error('Authentication check failed:', error);
      return false;
    }
  }

  /**
   * Get user information using GitHub API
   */
  async getUserInfo(token: string): Promise<GitHubUser | null> {
    try {
      // Use direct GitHub API call
      const response = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `token ${token}`,
          'User-Agent': 'emdash-app'
        }
      });

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`);
      }

      const userData = await response.json() as any;

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
      const { stdout } = await execAsync(`${this.GH_PATH} repo list --limit 100 --json name,nameWithOwner,description,url,defaultBranchRef,isPrivate,updatedAt,primaryLanguage,stargazerCount,forkCount`);
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
   * Clone a repository to local workspace
   */
  async cloneRepository(repoUrl: string, localPath: string): Promise<{ success: boolean; error?: string }> {
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
        error: error instanceof Error ? error.message : 'Clone failed' 
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
