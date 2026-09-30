import { createOAuthDeviceAuth } from '@octokit/auth-oauth-device';
import type { IntegrationConnections } from '@core/features/integrations/api/node/integration-accounts';
import type { GitHubAccountSummary } from '@core/primitives/github/api';
import type { GitHubEvent, GitHubUser } from '@core/primitives/github/api';
import { connectGitHubAccount } from '../accounts/github-auth-connection';
import type { GitHubIdentityClient } from './github-identity-client';

export type GitHubDeviceFlowConfig = {
  clientId: string;
  scopes: string[];
};

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

export type GitHubDeviceFlowResult =
  | { success: true; user: GitHubUser; account: GitHubAccountSummary }
  | { success: false; error: string };

export class GitHubDeviceFlowService {
  private deviceFlowAbortController: AbortController | null = null;

  constructor(
    private readonly deps: {
      connections: IntegrationConnections;
      identityClient: Pick<GitHubIdentityClient, 'getAuthenticatedUser'>;
      publishEvent(event: GitHubEvent): void;
      createDeviceAuth: DeviceAuthFactory;
      config: GitHubDeviceFlowConfig;
    }
  ) {}

  async start(): Promise<GitHubDeviceFlowResult> {
    this.deviceFlowAbortController = new AbortController();
    const { signal } = this.deviceFlowAbortController;

    try {
      const auth = this.deps.createDeviceAuth({
        clientId: this.deps.config.clientId,
        scopes: [...this.deps.config.scopes],
        onVerification: (verification) => {
          this.deps.publishEvent({
            type: 'device-code',
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
        this.deps.publishEvent({ type: 'auth-error', error: 'device_flow_error', message });
        return { success: false, error: message };
      }

      const { account } = await connectGitHubAccount(this.deps.connections, {
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

      return { success: true, user, account };
    } catch (error) {
      if (signal.aborted) {
        return { success: false, error: 'Auth cancelled' };
      }

      const message = error instanceof Error ? error.message : String(error);
      this.deps.publishEvent({ type: 'auth-error', error: 'device_flow_error', message });
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
