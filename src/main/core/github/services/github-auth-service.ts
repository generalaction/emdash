import { createOAuthDeviceAuth } from '@octokit/auth-oauth-device';
import { Octokit } from '@octokit/rest';
import keytar from 'keytar';
import {
  githubAuthCancelledChannel,
  githubAuthDeviceCodeChannel,
  githubAuthErrorChannel,
  githubAuthSuccessChannel,
} from '@shared/events/githubEvents';
import type { GitHubConnectResponse, GitHubUser } from '@shared/github';
import { executeOAuthFlow } from '@main/core/shared/oauth-flow';
import { getLocalExec } from '@main/core/utils/exec';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { extractGhCliToken } from './gh-cli-token';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuthResult = GitHubConnectResponse;

export interface DeviceCodeResult {
  success: boolean;
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  expires_in?: number;
  interval?: number;
  error?: string;
}

/**
 * Manages GitHub authentication tokens regardless of how they were obtained
 * (Emdash Account OAuth, Device Flow, PAT, or extracted from gh CLI).
 */
export type TokenSource = 'keytar' | 'cli' | null;

export interface GitHubAuthService {
  getToken(): Promise<string | null>;
  getTokenSource(): Promise<TokenSource>;
  isAuthenticated(): Promise<boolean>;
  getCurrentUser(): Promise<GitHubUser | null>;
  getUserInfo(token: string): Promise<GitHubUser | null>;
  startOAuthFlow(authServerBaseUrl: string): Promise<AuthResult>;
  startDeviceFlowAuth(): Promise<DeviceCodeResult>;
  storeToken(token: string): Promise<void>;
  cancelAuth(): void;
  logout(): Promise<void>;
}

const SERVICE_NAME = 'emdash-github';
const ACCOUNT_NAME = 'github-token';
const TOKEN_SOURCE_ACCOUNT_NAME = 'github-token-source';

const GITHUB_CONFIG = {
  clientId: 'Ov23ligC35uHWopzCeWf',
  scopes: ['repo', 'read:user', 'read:org'],
} as const;

export class GitHubAuthServiceImpl implements GitHubAuthService {
  private deviceFlowAbortController: AbortController | null = null;

  private async getStoredTokenRecord(): Promise<{ token: string | null; source: TokenSource }> {
    try {
      const [token, rawSource] = await Promise.all([
        keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME),
        keytar.getPassword(SERVICE_NAME, TOKEN_SOURCE_ACCOUNT_NAME),
      ]);
      const source: TokenSource = rawSource === 'cli' || rawSource === 'keytar' ? rawSource : null;
      return { token: token ?? null, source };
    } catch {
      return { token: null, source: null };
    }
  }

  private async clearStoredToken(): Promise<void> {
    await Promise.all([
      keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME),
      keytar.deletePassword(SERVICE_NAME, TOKEN_SOURCE_ACCOUNT_NAME),
    ]);
  }

  async getToken(): Promise<string | null> {
    const { token: storedToken, source } = await this.getStoredTokenRecord();
    const exec = getLocalExec();

    if (storedToken && source === 'cli') {
      const cliToken = await extractGhCliToken(exec);
      if (!cliToken) {
        try {
          await this.clearStoredToken();
        } catch (error) {
          log.warn('Failed to clear stale CLI token from keytar:', error);
        }
        return null;
      }
      if (cliToken !== storedToken) {
        try {
          await this.storeToken(cliToken, 'cli');
        } catch (error) {
          log.warn('Failed to sync refreshed CLI token to keytar:', error);
        }
        return cliToken;
      }
      return storedToken;
    }

    if (storedToken) return storedToken;

    const cliToken = await extractGhCliToken(exec);
    if (!cliToken) return null;

    try {
      await this.storeToken(cliToken, 'cli');
    } catch (error) {
      log.warn('Failed to cache CLI token in keytar:', error);
    }
    return cliToken;
  }

  async getTokenSource(): Promise<TokenSource> {
    const token = await this.getToken();
    if (!token) return null;

    const { source } = await this.getStoredTokenRecord();
    if (source) return source;

    const cliToken = await extractGhCliToken(getLocalExec());
    if (cliToken && cliToken === token) return 'cli';

    return 'keytar';
  }

  async isAuthenticated(): Promise<boolean> {
    const token = await this.getToken();
    return token !== null;
  }

  async getCurrentUser(): Promise<GitHubUser | null> {
    const token = await this.getToken();
    if (!token) return null;
    return this.getUserInfo(token);
  }

  async getUserInfo(token: string): Promise<GitHubUser | null> {
    try {
      const octokit = new Octokit({ auth: token });
      const { data } = await octokit.rest.users.getAuthenticated();
      return {
        id: data.id,
        login: data.login,
        name: data.name ?? '',
        email: data.email ?? '',
        avatar_url: data.avatar_url,
      };
    } catch {
      return null;
    }
  }

  async startOAuthFlow(authServerBaseUrl: string): Promise<AuthResult> {
    try {
      const raw = await executeOAuthFlow({
        authorizeUrl: `${authServerBaseUrl}/auth/github`,
        exchangeUrl: `${authServerBaseUrl}/api/v1/auth/electron/exchange`,
        successRedirectUrl: `${authServerBaseUrl}/auth/success`,
        errorRedirectUrl: `${authServerBaseUrl}/auth/error`,
      });

      const accessToken = raw.accessToken as string;
      if (!accessToken) {
        return { success: false, error: 'No access token in response' };
      }

      await this.storeToken(accessToken);
      const user = await this.getUserInfo(accessToken);
      return { success: true, token: accessToken, user: user || undefined };
    } catch (error) {
      log.warn('GitHub OAuth flow failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'OAuth authentication failed',
      };
    }
  }

  async startDeviceFlowAuth(): Promise<DeviceCodeResult> {
    this.deviceFlowAbortController = new AbortController();
    const { signal } = this.deviceFlowAbortController;

    try {
      const auth = createOAuthDeviceAuth({
        clientId: GITHUB_CONFIG.clientId,
        scopes: [...GITHUB_CONFIG.scopes],
        onVerification: (verification) => {
          events.emit(githubAuthDeviceCodeChannel, {
            userCode: verification.user_code,
            verificationUri: verification.verification_uri,
            expiresIn: verification.expires_in,
            interval: verification.interval,
          });
        },
      });

      const authPromise = auth({ type: 'oauth' });

      const cancelPromise = new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => {
          reject(new Error('Auth cancelled'));
        });
      });

      const result = await Promise.race([authPromise, cancelPromise]);
      const token = result.token;

      await this.storeToken(token);

      const user = await this.getUserInfo(token);

      if (user) {
        events.emit(githubAuthSuccessChannel, { token, user });
      }

      return {
        success: true,
        device_code: undefined,
        user_code: undefined,
        verification_uri: undefined,
      };
    } catch (error) {
      if (signal.aborted) {
        events.emit(githubAuthCancelledChannel, undefined);
        return { success: false, error: 'Auth cancelled' };
      }

      const message = error instanceof Error ? error.message : String(error);
      events.emit(githubAuthErrorChannel, { error: 'device_flow_error', message });
      return { success: false, error: message };
    } finally {
      this.deviceFlowAbortController = null;
    }
  }

  async storeToken(token: string, source: Exclude<TokenSource, null> = 'keytar'): Promise<void> {
    await Promise.all([
      keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, token),
      keytar.setPassword(SERVICE_NAME, TOKEN_SOURCE_ACCOUNT_NAME, source),
    ]);
  }

  cancelAuth(): void {
    if (this.deviceFlowAbortController) {
      this.deviceFlowAbortController.abort();
      this.deviceFlowAbortController = null;
    }
  }

  async logout(): Promise<void> {
    await this.clearStoredToken();
  }
}

export const githubAuthService = new GitHubAuthServiceImpl();
