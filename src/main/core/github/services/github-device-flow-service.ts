import { createOAuthDeviceAuth } from '@octokit/auth-oauth-device';
import {
  githubAuthCancelledChannel,
  githubAuthDeviceCodeChannel,
  githubAuthErrorChannel,
} from '@shared/events/githubEvents';
import type { GitHubUser } from '@shared/github';
import type { GitHubAccount, GitHubAccountRegistry } from '../accounts/github-account-registry';
import type { GitHubIdentityClient } from './github-identity-client';

const GITHUB_CONFIG = {
  clientId: 'Ov23ligC35uHWopzCeWf',
  scopes: ['repo', 'read:user', 'read:org'],
} as const;

type DeviceAuth = (options: { type: 'oauth' }) => Promise<{ token: string }>;

type DeviceAuthFactory = (options: {
  clientId: string;
  scopes: string[];
  onVerification(verification: {
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  }): void;
}) => DeviceAuth;

type DeviceFlowEvents = {
  emit(channel: unknown, payload: unknown): void;
};

export type GitHubDeviceFlowResult =
  | { success: true; token: string; user: GitHubUser; account: GitHubAccount }
  | { success: false; error: string };

export class GitHubDeviceFlowService {
  private deviceFlowAbortController: AbortController | null = null;

  constructor(
    private readonly deps: {
      accountRegistry: GitHubAccountRegistry;
      identityClient: Pick<GitHubIdentityClient, 'getAuthenticatedUser'>;
      events: DeviceFlowEvents;
      createDeviceAuth: DeviceAuthFactory;
    }
  ) {}

  async start(): Promise<GitHubDeviceFlowResult> {
    this.deviceFlowAbortController = new AbortController();
    const { signal } = this.deviceFlowAbortController;

    try {
      const auth = this.deps.createDeviceAuth({
        clientId: GITHUB_CONFIG.clientId,
        scopes: [...GITHUB_CONFIG.scopes],
        onVerification: (verification) => {
          this.deps.events.emit(githubAuthDeviceCodeChannel, {
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

      const user = await this.deps.identityClient.getAuthenticatedUser(token, 'github.com');
      if (!user) {
        const message = 'Failed to read authenticated GitHub user';
        this.deps.events.emit(githubAuthErrorChannel, { error: 'device_flow_error', message });
        return { success: false, error: message };
      }

      const account = await this.deps.accountRegistry.upsertAccount({
        accessToken: token,
        credentialSource: 'device_flow',
        providerAccount: {
          providerId: 'github',
          providerAccountId: String(user.id),
          host: 'github.com',
          login: user.login,
          avatarUrl: user.avatar_url,
        },
      });

      return { success: true, token, user, account };
    } catch (error) {
      if (signal.aborted) {
        this.deps.events.emit(githubAuthCancelledChannel, undefined);
        return { success: false, error: 'Auth cancelled' };
      }

      const message = error instanceof Error ? error.message : String(error);
      this.deps.events.emit(githubAuthErrorChannel, { error: 'device_flow_error', message });
      return { success: false, error: message };
    } finally {
      this.deviceFlowAbortController = null;
    }
  }

  cancel(): void {
    if (this.deviceFlowAbortController) {
      this.deviceFlowAbortController.abort();
      this.deviceFlowAbortController = null;
    }
  }
}

export const defaultGitHubDeviceAuthFactory = createOAuthDeviceAuth;
