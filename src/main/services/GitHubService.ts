import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { shell } from 'electron';
import { GITHUB_CONFIG } from '../config/github.config';
import { getMainWindow } from '../app/window';
import { databaseService } from './DatabaseService';

const execAsync = promisify(exec);

export interface GitHubUser {
  id: number | string;
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

  // Simple ID generator
  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

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
          // Success! Stop polling but don't emit success immediately
          this.stopPolling();

          // For device flow, success will be emitted in background task after account is saved
          // This ensures account data is available when the UI receives the success event
          return;
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
        // Return immediately - don't block on storage/auth/user fetching
        // This allows UI to update instantly
        const token = data.access_token;

        // Do heavy operations in background
        setImmediate(async () => {
          try {
            // Get user info first
            const user = await this.getUserInfo(token);

            if (user) {
              // Create account record
              const account = {
                id: String(user.id ?? this.generateId()),
                login: user.login,
                name: user.name,
                email: user.email,
                avatar_url: user.avatar_url,
                isDefault: false,
                isActive: true,
              };

              // Store account in database
              await databaseService.saveGithubAccount(account);

              // Store token securely with account login as identifier
              await this.storeTokenForAccount(token, user.login);

              // Set as active account
              await databaseService.setActiveGithubAccount(account.id);

              // Authenticate gh CLI with the token
              await this.authenticateGHCLI(token).catch(() => {
                // Silent fail - gh CLI might not be installed
              });

              // Send success update
              const mainWindow = getMainWindow();
              if (mainWindow) {
                mainWindow.webContents.send('github:auth:success', {
                  token: token,
                  user: user,
                  account: account,
                });
              }
            }
          } catch (error) {
            console.warn('Background auth setup failed:', error);
            const mainWindow = getMainWindow();
            if (mainWindow) {
              mainWindow.webContents.send('github:auth:error', {
                error: 'Failed to save account information',
                message: 'Authentication succeeded but failed to save account.',
              });
            }
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
        // Try to re-authenticate gh CLI with the active account token (fall back to legacy token)
        const activeAccount = await this.getActiveGithubAccount();
        let token: string | null = null;

        if (activeAccount) {
          token = await this.getStoredTokenForAccount(activeAccount.login);
        }

        if (!token) {
          token = await this.getStoredToken();
        }

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
   * Get all stored GitHub accounts
   */
  async getGithubAccounts() {
    return await databaseService.getGithubAccounts();
  }

  /**
   * Get the currently active GitHub account
   */
  async getActiveGithubAccount() {
    return await databaseService.getActiveGithubAccount();
  }

  /**
   * Switch to a different GitHub account
   */
  async switchToGithubAccount(accountId: string): Promise<AuthResult> {
    try {
      const account = await databaseService.getGithubAccountById(accountId);
      if (!account) {
        return { success: false, error: 'Account not found' };
      }

      // Get the stored token for this account
      const token = await this.getStoredTokenForAccount(account.login);
      if (!token) {
        return { success: false, error: 'Token not found for account' };
      }

      // Set as active account
      await databaseService.setActiveGithubAccount(accountId);

      // Authenticate gh CLI with the token
      await this.authenticateGHCLI(token).catch(() => {
        // Silent fail - gh CLI might not be installed
      });

      const parsedId = Number.parseInt(account.id, 10);
      const normalizedId = Number.isNaN(parsedId) ? account.id : parsedId;

      return {
        success: true,
        token: token,
        user: {
          id: normalizedId,
          login: account.login,
          name: account.name,
          email: account.email,
          avatar_url: account.avatar_url,
        }
      };
    } catch (error) {
      console.error('Account switching failed:', error);
      return {
        success: false,
        error: 'Failed to switch account',
      };
    }
  }

  /**
   * Remove a GitHub account
   */
  async removeGithubAccount(accountId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const account = await databaseService.getGithubAccountById(accountId);
      if (!account) {
        return { success: false, error: 'Account not found' };
      }

      // Remove stored token
      await this.removeTokenForAccount(account.login);

      // Remove from database
      await databaseService.removeGithubAccount(accountId);

      // If there is another account available, ensure gh CLI is authenticated with it
      const nextActiveAccount = await databaseService.getActiveGithubAccount();
      if (nextActiveAccount) {
        const nextToken = await this.getStoredTokenForAccount(nextActiveAccount.login);
        if (nextToken) {
          await this.authenticateGHCLI(nextToken).catch(() => {
            // Silent fail - gh CLI might not be installed
          });
        }
      }

      return { success: true };
    } catch (error) {
      console.error('Account removal failed:', error);
      return {
        success: false,
        error: 'Failed to remove account',
      };
    }
  }

  /**
   * Set default GitHub account
   */
  async setDefaultGithubAccount(accountId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await databaseService.setDefaultGithubAccount(accountId);
      return { success: true };
    } catch (error) {
      console.error('Failed to set default account:', error);
      return {
        success: false,
        error: 'Failed to set default account',
      };
    }
  }

  /**
   * Authenticate with GitHub using Personal Access Token (multi-account version)
   */
  async authenticateWithToken(token: string): Promise<AuthResult> {
    try {
      // Test the token by getting user info
      const user = await this.getUserInfo(token);

      if (user) {
        // Create account record
        const account = {
          id: String(user.id ?? this.generateId()),
          login: user.login,
          name: user.name,
          email: user.email,
          avatar_url: user.avatar_url,
          isDefault: false,
          isActive: true,
        };

        // Store account in database
        await databaseService.saveGithubAccount(account);

        // Store token securely
        await this.storeTokenForAccount(token, user.login);

        // Set as active account
        await databaseService.setActiveGithubAccount(account.id);

        // Authenticate gh CLI with this token
        await this.authenticateGHCLI(token).catch(() => {
          // Silent fail - gh CLI might not be installed
        });

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
   * Check if user is authenticated (multi-account version)
   */
  async isAuthenticated(): Promise<boolean> {
    try {
      const accounts = await this.getGithubAccounts();
      const existingActive = accounts.find((account) => account.isActive);
      let activeAccount = existingActive ?? accounts[0] ?? null;

      if (activeAccount && !activeAccount.isActive) {
        await databaseService.setActiveGithubAccount(activeAccount.id);
        activeAccount = { ...activeAccount, isActive: true };
      }

      let token: string | null = null;

      if (activeAccount) {
        token = await this.getStoredTokenForAccount(activeAccount.login);
      }

      if (!token) {
        token = await this.getStoredToken();
      }

      if (!token) {
        token = await this.getGhCliToken();
      }

      if (!token) {
        // No stored tokens and not logged into gh CLI
        return false;
      }

      // Test the token by making a simple API call
      const user = await this.getUserInfo(token);
      if (!user) {
        return false;
      }

      const hasDefault = accounts.some((account) => account.isDefault);
      if (!activeAccount || activeAccount.login !== user.login) {
        const migratedAccount = {
          id: String(user.id ?? this.generateId()),
          login: user.login,
          name: user.name,
          email: user.email,
          avatar_url: user.avatar_url,
          isDefault: activeAccount?.isDefault ?? !hasDefault,
          isActive: true,
        };

        await databaseService.saveGithubAccount(migratedAccount);
        await databaseService.setActiveGithubAccount(migratedAccount.id);
        activeAccount =
          (await databaseService.getGithubAccountById(migratedAccount.id)) ?? activeAccount;
      }

      // Persist tokens for the active account (and legacy location for compatibility)
      await this.storeTokenForAccount(token, user.login);
      await this.storeToken(token);

      return true;
    } catch (error) {
      console.error('Authentication check failed:', error);
      return false;
    }
  }

  /**
   * Get user information using the provided token
   */
  async getUserInfo(token: string): Promise<GitHubUser | null> {
    try {
      if (!token) return null;

      // Prefer direct API call (works without gh CLI)
      try {
        const response = await fetch('https://api.github.com/user', {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'Emdash',
          },
        });

        if (response.ok) {
          const userData = await response.json();

          return {
            id: userData.id,
            login: userData.login,
            name: userData.name || userData.login,
            email: userData.email || '',
            avatar_url: userData.avatar_url,
          };
        }
      } catch (apiError) {
        console.warn('Direct GitHub API lookup failed, falling back to gh CLI:', apiError);
      }

      // Fallback to gh CLI if available
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
   * Logout and clear all stored tokens and accounts
   */
  async logout(): Promise<void> {
    try {
      // Get all accounts to remove their tokens
      const accounts = await this.getGithubAccounts();

      // Remove all stored tokens
      for (const account of accounts) {
        await this.removeTokenForAccount(account.login);
      }

      // Clear all accounts from database
      await databaseService.clearGithubAccounts();

      // Remove legacy single-account token
      const keytar = await import('keytar');
      await keytar.deletePassword(this.SERVICE_NAME, this.ACCOUNT_NAME);
    } catch (error) {
      console.error('Failed to logout:', error);
    }
  }

  /**
   * Store authentication token securely (legacy method for backward compatibility)
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
   * Retrieve stored authentication token (legacy method for backward compatibility)
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
   * Store authentication token for a specific account
   */
  private async storeTokenForAccount(token: string, accountLogin: string): Promise<void> {
    try {
      const keytar = await import('keytar');
      await keytar.setPassword(this.SERVICE_NAME, `${this.ACCOUNT_NAME}-${accountLogin}`, token);
    } catch (error) {
      console.error('Failed to store token for account:', error);
      throw error;
    }
  }

  /**
   * Retrieve stored authentication token for a specific account
   */
  private async getStoredTokenForAccount(accountLogin: string): Promise<string | null> {
    try {
      const keytar = await import('keytar');
      return await keytar.getPassword(this.SERVICE_NAME, `${this.ACCOUNT_NAME}-${accountLogin}`);
    } catch (error) {
      console.error('Failed to retrieve token for account:', error);
      return null;
    }
  }

  /**
   * Remove stored authentication token for a specific account
   */
  private async removeTokenForAccount(accountLogin: string): Promise<void> {
    try {
      const keytar = await import('keytar');
      await keytar.deletePassword(this.SERVICE_NAME, `${this.ACCOUNT_NAME}-${accountLogin}`);
    } catch (error) {
      console.error('Failed to remove token for account:', error);
    }
  }

  /**
   * Retrieve token from gh CLI if the user is already logged in there
   */
  private async getGhCliToken(): Promise<string | null> {
    try {
      const { stdout: statusOutput } = await execAsync('gh auth status --hostname github.com');
      const isLoggedIn = String(statusOutput || '').toLowerCase().includes('logged in');
      if (!isLoggedIn) {
        return null;
      }

      const { stdout } = await execAsync('gh auth token');
      const token = String(stdout || '').trim();
      return token || null;
    } catch (error) {
      console.warn('Failed to read token from gh CLI:', error);
      return null;
    }
  }
}
