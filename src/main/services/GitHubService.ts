import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { GITHUB_CONFIG } from '../config/github.config';
import { getMainWindow } from '../app/window';

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

  // Polling state management
  private isPolling = false;
  private pollingInterval: NodeJS.Timeout | null = null;
  private currentDeviceCode: string | null = null;
  private currentInterval = 5;

  /**
   * Authenticate with GitHub using Device Flow
   * Returns device code info for the UI to display to the user
   */
  async authenticate(): Promise<DeviceCodeResult | AuthResult> {
    return await this.requestDeviceCode();
  }

  /**
   * Start Device Flow authentication with automatic background polling
   * Emits events to renderer for UI updates
   * Returns immediately with device code info
   */
  async startDeviceFlowAuth(): Promise<DeviceCodeResult> {
    // Stop any existing polling
    this.stopPolling();

    // Request device code
    const deviceCodeResult = await this.requestDeviceCode();

    if (!deviceCodeResult.success || !deviceCodeResult.device_code) {
      // Emit error to renderer
      const mainWindow = getMainWindow();
      if (mainWindow) {
        mainWindow.webContents.send('github:auth:error', {
          error: deviceCodeResult.error || 'Failed to request device code',
        });
      }
      return deviceCodeResult;
    }

    // Store device code and interval
    this.currentDeviceCode = deviceCodeResult.device_code;
    this.currentInterval = deviceCodeResult.interval || 5;
    this.isPolling = true;

    // Give renderer time to mount modal and subscribe to events
    // Then emit device code for display
    setTimeout(() => {
      const mainWindow = getMainWindow();
      if (mainWindow) {
        mainWindow.webContents.send('github:auth:device-code', {
          userCode: deviceCodeResult.user_code,
          verificationUri: deviceCodeResult.verification_uri,
          expiresIn: deviceCodeResult.expires_in,
          interval: this.currentInterval,
        });
      }
    }, 100); // 100ms delay to ensure modal is mounted

    // Start background polling
    this.startBackgroundPolling(deviceCodeResult.expires_in || 900);

    return deviceCodeResult;
  }

  /**
   * Start background polling loop
   */
  private startBackgroundPolling(expiresIn: number): void {
    if (!this.currentDeviceCode) return;

    const startTime = Date.now();
    const expiresAt = startTime + expiresIn * 1000;

    const poll = async () => {
      if (!this.isPolling || !this.currentDeviceCode) {
        this.stopPolling();
        return;
      }

      // Check if expired
      if (Date.now() >= expiresAt) {
        this.stopPolling();
        const mainWindow = getMainWindow();
        if (mainWindow) {
          mainWindow.webContents.send('github:auth:error', {
            error: 'expired_token',
            message: 'Authorization code expired. Please try again.',
          });
        }
        return;
      }

      try {
        const result = await this.pollDeviceToken(this.currentDeviceCode, this.currentInterval);

        if (result.success && result.token) {
          // Success! Emit immediately
          this.stopPolling();
          const mainWindow = getMainWindow();
          if (mainWindow) {
            mainWindow.webContents.send('github:auth:success', {
              token: result.token,
              user: result.user || undefined,
            });
          }
        } else if (result.error) {
          const mainWindow = getMainWindow();

          if (result.error === 'authorization_pending') {
            // Still waiting - emit polling status
            if (mainWindow) {
              mainWindow.webContents.send('github:auth:polling', {
                status: 'waiting',
              });
            }
          } else if (result.error === 'slow_down') {
            // GitHub wants us to slow down
            this.currentInterval += 5;
            if (mainWindow) {
              mainWindow.webContents.send('github:auth:slow-down', {
                newInterval: this.currentInterval,
              });
            }

            // Restart interval with new timing
            if (this.pollingInterval) {
              clearInterval(this.pollingInterval);
              this.pollingInterval = setInterval(poll, this.currentInterval * 1000);
            }
          } else if (result.error === 'expired_token') {
            // Code expired
            this.stopPolling();
            if (mainWindow) {
              mainWindow.webContents.send('github:auth:error', {
                error: 'expired_token',
                message: 'Authorization code expired. Please try again.',
              });
            }
          } else if (result.error === 'access_denied') {
            // User denied
            this.stopPolling();
            if (mainWindow) {
              mainWindow.webContents.send('github:auth:error', {
                error: 'access_denied',
                message: 'Authorization was cancelled.',
              });
            }
          } else {
            // Unknown error
            this.stopPolling();
            if (mainWindow) {
              mainWindow.webContents.send('github:auth:error', {
                error: result.error,
                message: `Authentication failed: ${result.error}`,
              });
            }
          }
        }
      } catch (error) {
        console.error('Polling error:', error);
        const mainWindow = getMainWindow();
        if (mainWindow) {
          mainWindow.webContents.send('github:auth:error', {
            error: 'network_error',
            message: 'Network error during authentication. Please try again.',
          });
        }
        this.stopPolling();
      }
    };

    // Start polling with initial interval
    setTimeout(poll, this.currentInterval * 1000);
    this.pollingInterval = setInterval(poll, this.currentInterval * 1000);
  }

  /**
   * Stop the background polling
   */
  stopPolling(): void {
    this.isPolling = false;
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.currentDeviceCode = null;
    this.currentInterval = 5;
  }

  /**
   * Cancel the authentication flow
   */
  cancelAuth(): void {
    this.stopPolling();
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send('github:auth:cancelled', {});
    }
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
  async pollDeviceToken(deviceCode: string, _interval: number = 5): Promise<AuthResult> {
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
        // Return immediately - don't block on storage/auth/user fetching
        // This allows UI to update instantly
        const token = data.access_token;

        // Do heavy operations in background
        setImmediate(async () => {
          try {
            // Store token securely
            await this.storeToken(token);

            // Authenticate gh CLI with the token
            await this.authenticateGHCLI(token).catch(() => {
              // Silent fail - gh CLI might not be installed
            });

            // Get user info and send update
            const user = await this.getUserInfo(token);
            const mainWindow = getMainWindow();
            if (user && mainWindow) {
              mainWindow.webContents.send('github:auth:user-updated', {
                user: user,
              });
            }
          } catch (error) {
            console.warn('Background auth setup failed:', error);
          }
        });

        return {
          success: true,
          token: token,
          user: undefined, // Will be sent via user-updated event
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
  async getUserInfo(_token: string): Promise<GitHubUser | null> {
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
  async getRepositories(_token: string): Promise<GitHubRepo[]> {
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
   * Validate repository name format
   */
  validateRepositoryName(name: string): { valid: boolean; error?: string } {
    if (!name || name.trim().length === 0) {
      return { valid: false, error: 'Repository name is required' };
    }

    const trimmed = name.trim();

    // Check length
    if (trimmed.length > 100) {
      return { valid: false, error: 'Repository name must be 100 characters or less' };
    }

    // Check for valid characters (alphanumeric, hyphens, underscores, dots)
    // GitHub allows: a-z, A-Z, 0-9, -, _, .
    if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
      return {
        valid: false,
        error: 'Repository name can only contain letters, numbers, hyphens, underscores, and dots',
      };
    }

    // Cannot start or end with hyphen, dot, or underscore
    if (/^[-._]|[-._]$/.test(trimmed)) {
      return {
        valid: false,
        error: 'Repository name cannot start or end with a hyphen, dot, or underscore',
      };
    }

    // Cannot be all dots
    if (/^\.+$/.test(trimmed)) {
      return { valid: false, error: 'Repository name cannot be all dots' };
    }

    // Reserved names (basic ones, GitHub has more)
    const reserved = [
      'con',
      'prn',
      'aux',
      'nul',
      'com1',
      'com2',
      'com3',
      'com4',
      'com5',
      'com6',
      'com7',
      'com8',
      'com9',
      'lpt1',
      'lpt2',
      'lpt3',
      'lpt4',
      'lpt5',
      'lpt6',
      'lpt7',
      'lpt8',
      'lpt9',
    ];
    if (reserved.includes(trimmed.toLowerCase())) {
      return { valid: false, error: 'Repository name is reserved' };
    }

    return { valid: true };
  }

  /**
   * Check if a repository exists for the given owner and name
   */
  async checkRepositoryExists(owner: string, name: string): Promise<boolean> {
    try {
      await this.execGH(`gh repo view ${owner}/${name}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get available owners (user + organizations)
   */
  async getOwners(): Promise<Array<{ login: string; type: 'User' | 'Organization' }>> {
    try {
      // Get current user
      const { stdout: userStdout } = await this.execGH('gh api user');
      const user = JSON.parse(userStdout);

      const owners: Array<{ login: string; type: 'User' | 'Organization' }> = [
        { login: user.login, type: 'User' },
      ];

      // Get organizations
      try {
        const { stdout: orgsStdout } = await this.execGH('gh api user/orgs');
        const orgs = JSON.parse(orgsStdout);
        if (Array.isArray(orgs)) {
          for (const org of orgs) {
            owners.push({ login: org.login, type: 'Organization' });
          }
        }
      } catch (error) {
        // If orgs fetch fails, just continue with user only
        console.warn('Failed to fetch organizations:', error);
      }

      return owners;
    } catch (error) {
      console.error('Failed to get owners:', error);
      throw error;
    }
  }

  /**
   * Create a new GitHub repository
   */
  async createRepository(params: {
    name: string;
    description?: string;
    owner: string;
    isPrivate: boolean;
  }): Promise<{ url: string; defaultBranch: string; fullName: string }> {
    try {
      const { name, description, owner, isPrivate } = params;

      // Build gh repo create command
      const visibilityFlag = isPrivate ? '--private' : '--public';
      let command = `gh repo create ${owner}/${name} ${visibilityFlag} --confirm`;

      if (description && description.trim()) {
        // Escape description for shell
        const desc = JSON.stringify(description.trim());
        command += ` --description ${desc}`;
      }

      await this.execGH(command);

      // Get repository details
      const { stdout } = await this.execGH(
        `gh repo view ${owner}/${name} --json name,nameWithOwner,url,defaultBranchRef`
      );
      const repoInfo = JSON.parse(stdout);

      return {
        url: repoInfo.url || `https://github.com/${repoInfo.nameWithOwner}`,
        defaultBranch: repoInfo.defaultBranchRef?.name || 'main',
        fullName: repoInfo.nameWithOwner || `${owner}/${name}`,
      };
    } catch (error) {
      console.error('Failed to create repository:', error);
      throw error;
    }
  }

  /**
   * Initialize a new project with initial files and commit
   */
  async initializeNewProject(params: {
    repoUrl: string;
    localPath: string;
    name: string;
    description?: string;
  }): Promise<void> {
    const { repoUrl, localPath, name, description } = params;

    try {
      // Ensure the directory exists (clone should have created it, but just in case)
      if (!fs.existsSync(localPath)) {
        throw new Error('Local path does not exist after clone');
      }

      // Create README.md
      const readmePath = path.join(localPath, 'README.md');
      const readmeContent = description ? `# ${name}\n\n${description}\n` : `# ${name}\n`;
      fs.writeFileSync(readmePath, readmeContent, 'utf8');

      // Initialize git, add files, commit, and push
      const execOptions = { cwd: localPath };

      // Add and commit
      await execAsync('git add README.md', execOptions);
      await execAsync('git commit -m "Initial commit"', execOptions);

      // Push to origin
      await execAsync('git push -u origin main', execOptions).catch(async () => {
        // If main branch doesn't exist, try master
        try {
          await execAsync('git push -u origin master', execOptions);
        } catch {
          // If both fail, let the error propagate
          throw new Error('Failed to push to remote repository');
        }
      });
    } catch (error) {
      console.error('Failed to initialize new project:', error);
      throw error;
    }
  }

  /**
   * Clone a repository to local task directory
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
