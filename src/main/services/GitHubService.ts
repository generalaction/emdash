import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { GITHUB_CONFIG } from '../config/github.config';
import { getMainWindow } from '../app/window';
import { errorTracking } from '../errorTracking';
import { sortByUpdatedAtDesc } from '../utils/issueSorting';
import { quoteShellArg } from '../utils/shellEscape';

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

export interface GitHubReviewer {
  login: string;
  state?: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
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
  reviewDecision?: string | null;
  reviewers?: GitHubReviewer[];
  additions?: number;
  deletions?: number;
  checksStatus?: 'pass' | 'fail' | 'pending' | 'none';
}

export interface GitHubPullRequestListResult {
  prs: GitHubPullRequest[];
  totalCount: number;
}

export interface GitHubPullRequestListOptions {
  limit?: number;
  searchQuery?: string;
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
  private readonly MIGRATION_BLOCK_ACCOUNT = 'github-migration-blocked';

  // Polling state management
  private isPolling = false;
  private pollingInterval: NodeJS.Timeout | null = null;
  private currentDeviceCode: string | null = null;
  private currentInterval = 5;

  // One-shot migration guard: try reading from `gh auth token` at most once
  // per process when the Emdash keychain is empty.
  private migrationAttempted = false;
  private migrationInFlight: Promise<string | null> | null = null;

  // Serializes auth state changes (logout + legacy token migration persistence).
  private authStateLock: Promise<void> = Promise.resolve();

  /**
   * Authenticate with GitHub using Device Flow
   * Returns device code info for the UI to display to the user
   */
  async authenticate(): Promise<DeviceCodeResult | AuthResult> {
    return await this.requestDeviceCode();
  }

  /**
   * Store a GitHub token obtained via OAuth (Emdash Accounts flow).
   */
  async storeTokenFromOAuth(token: string): Promise<void> {
    await this.storeToken(token);
  }

  /**
   * Start OAuth authentication via Emdash Account.
   * Opens browser to auth server, waits for loopback callback, exchanges code for token.
   */
  async startOAuthAuth(): Promise<AuthResult> {
    const { emdashAccountService } = await import('./EmdashAccountService');
    try {
      const result = await emdashAccountService.signIn();

      if (result.providerId === 'github') {
        await this.storeToken(result.accessToken);
      }

      const user = await this.getUserInfo(result.accessToken);

      if (user?.login) {
        await errorTracking.updateGithubUsername(user.login);
      }

      const mainWindow = getMainWindow();
      if (mainWindow) {
        mainWindow.webContents.send('github:auth:success', {
          token: result.accessToken,
          user,
        });
      }

      return { success: true, token: result.accessToken, user: user || undefined };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'OAuth authentication failed',
      };
    }
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

          // Update error tracking with GitHub username
          if (result.user?.login) {
            await errorTracking.updateGithubUsername(result.user.login);
          }

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

        // Track polling errors
        await errorTracking.captureGitHubError(error, 'poll_device_code');

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
        // We get the token, now fetch user info immediately before returning success.
        const token = data.access_token;
        const user = await this.getUserInfo(token);

        try {
          await this.storeToken(token);
        } catch (error) {
          console.warn('Failed to store token:', error);
        }

        const mainWindow = getMainWindow();
        if (user && mainWindow) {
          mainWindow.webContents.send('github:auth:user-updated', {
            user: user,
          });
        }

        return {
          success: true,
          token: token,
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
   * Environment for gh invocations. Always scope auth to Emdash's stored token
   * so we do not read or mutate the user's global gh login state.
   */
  async getCliEnvironment(
    extraEnv?: NodeJS.ProcessEnv
  ): Promise<NodeJS.ProcessEnv & { GH_TOKEN: string; GITHUB_TOKEN: string }> {
    const token = await this.getStoredToken();
    if (!token) {
      throw new Error('GitHub is not connected in Emdash');
    }

    return {
      ...process.env,
      ...extraEnv,
      GH_TOKEN: token,
      GITHUB_TOKEN: token,
    };
  }

  /**
   * Execute gh using Emdash's stored token.
   */
  private async execGH(
    command: string,
    options?: any
  ): Promise<{ stdout: string; stderr: string }> {
    const env = await this.getCliEnvironment(options?.env);
    const result = await execAsync(command, { encoding: 'utf8', ...options, env });
    return {
      stdout: String(result.stdout),
      stderr: String(result.stderr),
    };
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
      return sortByUpdatedAtDesc(list);
    } catch (error) {
      console.error('Failed to list GitHub issues:', error);
      return []; // Return empty array instead of throwing
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
      return sortByUpdatedAtDesc(list);
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

        // Update error tracking with GitHub username
        if (user.login) {
          await errorTracking.updateGithubUsername(user.login);
        }

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
        return false;
      }

      const user = await this.getUserInfo(token);
      return !!user;
    } catch (error) {
      console.error('Authentication check failed:', error);
      return false;
    }
  }

  /**
   * Get user information using the GitHub API.
   */
  async getUserInfo(token: string): Promise<GitHubUser | null> {
    try {
      if (!token) {
        return null;
      }

      const response = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
      }

      const userData = (await response.json()) as {
        id: number;
        login: string;
        name: string | null;
        email: string | null;
        avatar_url: string;
      };

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
   * Get current authenticated user information
   * This is a convenience method that doesn't require a token parameter
   */
  async getCurrentUser(): Promise<GitHubUser | null> {
    try {
      const token = await this.getStoredToken();
      return token ? await this.getUserInfo(token) : null;
    } catch (error) {
      console.error('Failed to get current user:', error);
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
  async getPullRequests(
    projectPath: string,
    options: GitHubPullRequestListOptions = {}
  ): Promise<GitHubPullRequestListResult> {
    const safeLimit = Math.min(Math.max(Number(options.limit) || 30, 1), 200);
    const searchQuery = options.searchQuery?.trim() || '';

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
        'reviewRequests',
        'latestReviews',
        'reviewDecision',
        'additions',
        'deletions',
        'statusCheckRollup',
        'labels',
      ];
      const searchFlag = searchQuery ? ` --search ${quoteShellArg(searchQuery)}` : '';
      const { stdout } = await this.execGH(
        `gh pr list --state open --limit ${safeLimit}${searchFlag} --json ${fields.join(',')}`,
        { cwd: projectPath }
      );
      const list = JSON.parse(stdout || '[]');

      if (!Array.isArray(list)) {
        return { prs: [], totalCount: 0 };
      }

      const prs = sortByUpdatedAtDesc(
        list.map((item: any) => ({
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
          reviewDecision: item?.reviewDecision || null,
          reviewers: this.buildReviewerList(item?.reviewRequests, item?.latestReviews),
          additions: typeof item?.additions === 'number' ? item.additions : undefined,
          deletions: typeof item?.deletions === 'number' ? item.deletions : undefined,
          checksStatus: this.deriveChecksStatus(item?.statusCheckRollup),
          labels: Array.isArray(item?.labels) ? item.labels : [],
        }))
      );

      const totalCount =
        (await this.getOpenPullRequestCount(projectPath, searchQuery)) ?? prs.length;

      return { prs, totalCount };
    } catch (error) {
      console.error('Failed to list pull requests:', error);
      throw error;
    }
  }

  private deriveChecksStatus(rollup: any[]): 'pass' | 'fail' | 'pending' | 'none' {
    if (!Array.isArray(rollup) || rollup.length === 0) return 'none';

    let hasFail = false;
    let hasPending = false;
    let hasPass = false;

    for (const item of rollup) {
      if (item?.__typename === 'CheckRun') {
        if (item.status !== 'COMPLETED') {
          hasPending = true;
        } else {
          const c = item.conclusion;
          if (['FAILURE', 'ACTION_REQUIRED', 'TIMED_OUT', 'STARTUP_FAILURE'].includes(c)) {
            hasFail = true;
          } else if (['SUCCESS', 'NEUTRAL', 'SKIPPED', 'CANCELLED'].includes(c)) {
            hasPass = true;
          } else {
            hasPending = true;
          }
        }
      } else {
        // StatusContext
        const s = item?.state;
        if (['FAILURE', 'ERROR'].includes(s)) {
          hasFail = true;
        } else if (s === 'SUCCESS') {
          hasPass = true;
        } else {
          hasPending = true;
        }
      }
    }

    if (hasFail) return 'fail';
    if (hasPending) return 'pending';
    if (hasPass) return 'pass';
    return 'none';
  }

  private buildReviewerList(reviewRequests?: any[], latestReviews?: any[]): GitHubReviewer[] {
    const reviewerMap = new Map<string, GitHubReviewer>();

    // Add requested reviewers (pending review)
    if (Array.isArray(reviewRequests)) {
      for (const req of reviewRequests) {
        const login = req?.login || req?.name;
        if (login && typeof login === 'string') {
          reviewerMap.set(login, { login, state: 'PENDING' });
        }
      }
    }

    // Add/overwrite with latest review states
    if (Array.isArray(latestReviews)) {
      for (const review of latestReviews) {
        const login = review?.author?.login;
        const state = review?.state;
        if (login && typeof login === 'string') {
          reviewerMap.set(login, {
            login,
            state: state || undefined,
          });
        }
      }
    }

    return Array.from(reviewerMap.values());
  }

  private async getOpenPullRequestCount(
    projectPath: string,
    searchQuery?: string
  ): Promise<number | null> {
    try {
      const { stdout: repoStdout } = await this.execGH(
        'gh repo view --json nameWithOwner --jq .nameWithOwner',
        { cwd: projectPath }
      );
      const repoNameWithOwner = repoStdout.trim();
      if (!repoNameWithOwner) return null;

      const queryParts = [`repo:${repoNameWithOwner}`, 'is:pr', 'is:open'];
      const normalizedSearchQuery = searchQuery?.trim();
      if (normalizedSearchQuery) {
        queryParts.push(normalizedSearchQuery);
      }
      const query = queryParts.join(' ');
      const { stdout } = await this.execGH(
        `gh api search/issues --method GET -f q=${quoteShellArg(query)} --jq .total_count`,
        { cwd: projectPath }
      );

      const totalCount = Number.parseInt(stdout.trim(), 10);
      return Number.isFinite(totalCount) ? totalCount : null;
    } catch (error) {
      console.warn('Failed to fetch open PR count:', error);
      return null;
    }
  }

  /**
   * Get details for a specific pull request (base/head branches, title, number).
   */
  async getPullRequestDetails(
    projectPath: string,
    prNumber: number
  ): Promise<{
    baseRefName: string;
    headRefName: string;
    title: string;
    number: number;
    url: string;
  } | null> {
    try {
      const fields = ['baseRefName', 'headRefName', 'title', 'number', 'url'];
      const { stdout } = await this.execGH(
        `gh pr view ${JSON.stringify(String(prNumber))} --json ${fields.join(',')}`,
        { cwd: projectPath }
      );
      const data = JSON.parse(stdout || 'null');
      if (!data || typeof data !== 'object') return null;
      return {
        baseRefName: data.baseRefName || '',
        headRefName: data.headRefName || '',
        title: data.title || '',
        number: data.number || prNumber,
        url: data.url || '',
      };
    } catch (error) {
      console.error('Failed to get pull request details:', error);
      return null;
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

    // Fetch the PR ref directly without checking out (avoids touching the working tree)
    try {
      const prRef = `refs/pull/${prNumber}/head`;
      await execAsync(
        `git fetch origin ${JSON.stringify(prRef)}:${JSON.stringify(`refs/heads/${safeBranch}`)} --force`,
        { cwd: projectPath }
      );
    } catch (fetchError) {
      // Fallback: use gh pr checkout to create/sync the local PR branch.
      console.warn(
        'Fetch-based PR branch creation failed, falling back to gh pr checkout:',
        fetchError
      );
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
        // Some gh/fork combinations can leave HEAD detached without a local branch ref.
        // Ensure the requested local branch exists for downstream worktree creation.
        try {
          await execAsync(
            `git show-ref --verify --quiet ${JSON.stringify(`refs/heads/${safeBranch}`)}`,
            { cwd: projectPath }
          );
        } catch {
          await execAsync(`git branch --force ${JSON.stringify(safeBranch)} HEAD`, {
            cwd: projectPath,
          });
        }
      } catch (error) {
        console.error('Failed during PR branch checkout or local-ref creation:', error);
        throw error;
      } finally {
        if (previousRef && previousRef !== safeBranch) {
          try {
            await execAsync(`git checkout ${JSON.stringify(previousRef)} --force`, {
              cwd: projectPath,
            });
          } catch (switchErr) {
            console.warn('Failed to restore previous branch after PR checkout:', switchErr);
          }
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

  private async withAuthStateLock<T>(operation: () => Promise<T>): Promise<T> {
    const previousLock = this.authStateLock;
    let releaseLock!: () => void;

    this.authStateLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    await previousLock;

    try {
      return await operation();
    } finally {
      releaseLock();
    }
  }

  /**
   * Logout and clear stored token
   */
  async logout(): Promise<void> {
    this.stopPolling();
    this.migrationAttempted = true;

    await this.withAuthStateLock(async () => {
      try {
        const keytar = await import('keytar');
        await keytar.deletePassword(this.SERVICE_NAME, this.ACCOUNT_NAME);
        await keytar.setPassword(this.SERVICE_NAME, this.MIGRATION_BLOCK_ACCOUNT, '1');
      } catch (error) {
        console.error('Failed to clear keychain token:', error);
        throw new Error('Failed to clear keychain token');
      }
    });
  }

  /**
   * Store authentication token securely
   */
  private async storeToken(token: string, source: 'user' | 'migration' = 'user'): Promise<void> {
    try {
      const keytar = await import('keytar');
      await keytar.setPassword(this.SERVICE_NAME, this.ACCOUNT_NAME, token);
      if (source === 'user') {
        await keytar.deletePassword(this.SERVICE_NAME, this.MIGRATION_BLOCK_ACCOUNT);
      }
    } catch (error) {
      console.error('Failed to store token:', error);
      throw error;
    }
  }

  /**
   * Retrieve stored authentication token.
   *
   * Migration for users authenticated before the gh-CLI decouple: their token
   * only lives in the global gh CLI state. If the Emdash keychain is empty we
   * try `gh auth token` once and persist the result, so PR lists and other
   * gh-backed features keep working without asking the user to re-auth.
   */
  async getStoredToken(): Promise<string | null> {
    if (this.migrationInFlight) {
      return this.migrationInFlight;
    }

    try {
      const keytar = await import('keytar');
      const stored = await keytar.getPassword(this.SERVICE_NAME, this.ACCOUNT_NAME);
      if (stored) return stored;

      const migrationBlocked =
        (await keytar.getPassword(this.SERVICE_NAME, this.MIGRATION_BLOCK_ACCOUNT)) === '1';
      if (migrationBlocked) return null;

      if (this.migrationInFlight) {
        return this.migrationInFlight;
      }

      if (this.migrationAttempted) return null;
    } catch (error) {
      console.error('Failed to retrieve token:', error);
      return null;
    }

    const inFlight = this.migrateTokenFromGHCLI();
    this.migrationInFlight = inFlight;

    try {
      return await inFlight;
    } finally {
      if (this.migrationInFlight === inFlight) {
        this.migrationInFlight = null;
      }
    }
  }

  private async migrateTokenFromGHCLI(): Promise<string | null> {
    return this.withAuthStateLock(async () => {
      if (this.migrationAttempted) return null;
      this.migrationAttempted = true;

      try {
        const keytar = await import('keytar');

        const migrationBlockedBeforeRead =
          (await keytar.getPassword(this.SERVICE_NAME, this.MIGRATION_BLOCK_ACCOUNT)) === '1';
        if (migrationBlockedBeforeRead) return null;

        const { stdout } = await execAsync('gh auth token', { encoding: 'utf8' });
        const token = String(stdout).trim();
        if (!token) return null;

        // Re-check auth state while still serialized with logout().
        const stored = await keytar.getPassword(this.SERVICE_NAME, this.ACCOUNT_NAME);
        if (stored) return stored;

        const migrationBlockedAfterRead =
          (await keytar.getPassword(this.SERVICE_NAME, this.MIGRATION_BLOCK_ACCOUNT)) === '1';
        if (migrationBlockedAfterRead) return null;

        try {
          await this.storeToken(token, 'migration');
        } catch (error) {
          console.warn('Failed to persist migrated gh CLI token to keychain:', error);
        }
        return token;
      } catch {
        return null;
      }
    });
  }
  // -----------------------------------------------------------------------
  // Repo events API — efficient polling with ETag caching
  // -----------------------------------------------------------------------

  /** ETag cache: repoNwo → { etag, rawEvents (unfiltered) } */
  private eventEtags = new Map<string, { etag: string; rawEvents: any[] }>();

  /**
   * Fetch recent repo events via the GitHub Events API.
   * Uses ETag conditional requests: returns cached events on 304 (no new activity)
   * so repeated polls are nearly free against the rate limit.
   *
   * Returns issue and PR creation/update events for automation triggers.
   */
  async fetchRepoEvents(projectPath: string, eventTypes?: string[]): Promise<RepoEvent[]> {
    try {
      // Get repo nwo (owner/repo)
      const { stdout: nwoOut } = await this.execGH(
        'gh repo view --json nameWithOwner --jq .nameWithOwner',
        { cwd: projectPath }
      );
      const nwo = nwoOut.trim();
      if (!nwo) return [];

      const cached = this.eventEtags.get(nwo);

      // Build gh api call with conditional ETag header
      const etagHeader = cached?.etag
        ? ` -H ${quoteShellArg(`If-None-Match: ${cached.etag}`)}`
        : '';
      const cmd = `gh api /repos/${nwo}/events?per_page=30${etagHeader} --include`;

      const typesFilter = eventTypes
        ? new Set(eventTypes)
        : new Set(['IssuesEvent', 'PullRequestEvent']);

      const filterRawEvents = (raw: any[]): RepoEvent[] =>
        raw
          .filter((e: any) => typesFilter.has(e.type))
          .map((e: any) => {
            const item = e.payload?.issue ?? e.payload?.pull_request;
            return {
              id: String(e.id),
              type: e.type,
              action: e.payload?.action ?? '',
              title: item?.title ?? '',
              number: item?.number ?? 0,
              url: item?.html_url ?? '',
              labels: (item?.labels ?? []).map((l: any) => l?.name ?? '').filter(Boolean),
              assignee: item?.assignee?.login ?? item?.user?.login ?? undefined,
              branch: e.payload?.pull_request?.head?.ref ?? undefined,
              createdAt: e.created_at ?? '',
            };
          });

      let stdout: string;
      try {
        const result = await this.execGH(cmd, { cwd: projectPath });
        stdout = result.stdout;
      } catch (err: any) {
        // gh api exits with non-zero on 304 — that means nothing changed
        const msg = err?.stderr || err?.message || '';
        if (msg.includes('304') || msg.includes('Not Modified')) {
          return filterRawEvents(cached?.rawEvents ?? []);
        }
        throw err;
      }

      // Parse response: --include prepends HTTP headers before the JSON body
      const headerEnd = stdout.indexOf('\r\n\r\n');
      const headerBlock = headerEnd >= 0 ? stdout.slice(0, headerEnd) : '';
      const jsonBody = headerEnd >= 0 ? stdout.slice(headerEnd + 4) : stdout;

      // Extract ETag from response headers
      const etagMatch = headerBlock.match(/ETag:\s*"?([^"\r\n]+)"?/i);
      const newEtag = etagMatch?.[1] ?? '';

      const rawEvents = JSON.parse(jsonBody || '[]');
      if (!Array.isArray(rawEvents)) return filterRawEvents(cached?.rawEvents ?? []);

      // Cache unfiltered events for next poll (so different eventTypes can reuse the cache)
      if (newEtag) {
        this.eventEtags.set(nwo, { etag: newEtag, rawEvents });
      }

      return filterRawEvents(rawEvents);
    } catch (error) {
      console.error('Failed to fetch repo events:', error);
      return [];
    }
  }
}

/** Structured repo event from the GitHub Events API */
export interface RepoEvent {
  id: string;
  type: string;
  action: string;
  title: string;
  number: number;
  url: string;
  labels: string[];
  assignee?: string;
  branch?: string;
  createdAt: string;
}

// Export singleton instance
export const githubService = new GitHubService();
