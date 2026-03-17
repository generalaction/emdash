import { createOAuthDeviceAuth } from '@octokit/auth-oauth-device';
import { Octokit } from '@octokit/rest';
import {
  githubAuthCancelledChannel,
  githubAuthDeviceCodeChannel,
  githubAuthErrorChannel,
  githubAuthSuccessChannel,
} from '@shared/events/githubEvents';
import { getLocalExec } from '@main/core/utils/exec';
import { events } from '@main/lib/events';
import { extractGhCliToken } from './gh-cli-token';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitHubUser {
  id: number;
  login: string;
  name: string;
  email: string;
  avatar_url: string;
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

/**
 * Manages GitHub authentication tokens regardless of how they were obtained
 * (Emdash Account OAuth, Device Flow, PAT, or extracted from gh CLI).
 */
export interface GitHubAuthService {
  getToken(): Promise<string | null>;
  isAuthenticated(): Promise<boolean>;
  getCurrentUser(): Promise<GitHubUser | null>;
  getUserInfo(token: string): Promise<GitHubUser | null>;
  startOAuthAuth(): Promise<AuthResult>;
  startDeviceFlowAuth(): Promise<DeviceCodeResult>;
  storeToken(token: string): Promise<void>;
  cancelAuth(): void;
  logout(): Promise<void>;
}

const SERVICE_NAME = 'emdash-github';
const ACCOUNT_NAME = 'github-token';

const GITHUB_CONFIG = {
  clientId: 'Ov23ligC35uHWopzCeWf',
  scopes: ['repo', 'read:user', 'read:org'],
} as const;

export class GitHubAuthServiceImpl implements GitHubAuthService {
  private deviceFlowAbortController: AbortController | null = null;

  async getToken(): Promise<string | null> {
    try {
      const keytar = await import('keytar');
      const stored = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
      if (stored) return stored;
    } catch {}

    const token = await extractGhCliToken(getLocalExec());
    if (token) {
      await this.storeToken(token);
      return token;
    }
    return null;
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

  async startOAuthAuth(): Promise<AuthResult> {
    return { success: false, error: 'OAuth auth not available on this branch' };
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

  async storeToken(token: string): Promise<void> {
    try {
      const keytar = await import('keytar');
      await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, token);
    } catch {}
  }

  cancelAuth(): void {
    if (this.deviceFlowAbortController) {
      this.deviceFlowAbortController.abort();
      this.deviceFlowAbortController = null;
    }
  }

  async logout(): Promise<void> {
    try {
      const keytar = await import('keytar');
      await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME);
    } catch {}
  }
}

export const githubAuthService = new GitHubAuthServiceImpl();
