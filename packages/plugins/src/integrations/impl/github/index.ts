import {
  isGitHubDotComHost,
  normalizeRepositoryHost,
} from '@emdash/core/primitives/repository/api';
import { ok } from '@emdash/shared';
import type { OAuthAccessToken, VerifyResult } from '../../capabilities/auth';
import { startDeviceAuthorizationSession, type FetchLike } from '../../helpers/oauth-device';
import { defineIntegrationPlugin, registerIntegrationPluginBehavior } from '../../plugin';
import { verifyGitHubCredentials } from './client';
import { icon } from './icon';
import { GITHUB_DOTCOM_API_BASE_URL, gitHubCredentialsSchema } from './types';

/** emdash's GitHub OAuth app, used for device sign-in. */
export const GITHUB_OAUTH_CLIENT_ID = 'Ov23ligC35uHWopzCeWf';
export const GITHUB_OAUTH_SCOPES = ['repo', 'read:user', 'read:org'];

const plugin = defineIntegrationPlugin(
  {
    id: 'github',
    name: 'GitHub',
    description: 'Work on GitHub issues and PRs',
    websiteUrl: 'https://github.com',
  },
  {
    auth: {
      methods: [
        { kind: 'oauth', providerId: 'github' },
        {
          kind: 'oauth-device',
          clientId: GITHUB_OAUTH_CLIENT_ID,
          scopes: GITHUB_OAUTH_SCOPES,
        },
        { kind: 'cli-import', cli: 'gh' },
      ],
    },
  },
  { icon }
);

/** REST API base URL for a GitHub host. */
function gitHubApiBaseUrlForHost(host: string): string {
  return isGitHubDotComHost(host)
    ? GITHUB_DOTCOM_API_BASE_URL
    : `https://${normalizeRepositoryHost(host)}/api/v3`;
}

export function createGitHubAuthBehavior(options: { fetch?: FetchLike } = {}) {
  return {
    credentialsSchema: gitHubCredentialsSchema,
    async verify(
      _host: unknown,
      credentials: Parameters<typeof verifyGitHubCredentials>[0]
    ): Promise<VerifyResult> {
      const result = await verifyGitHubCredentials(credentials);
      if (!result.success) {
        return {
          connected: false,
          error: result.error.message,
        };
      }

      return {
        connected: true,
        ...result.data,
      };
    },
    async startDeviceAuthorization() {
      return await startDeviceAuthorizationSession({
        deviceAuthorizationUrl: 'https://github.com/login/device/code',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        clientId: GITHUB_OAUTH_CLIENT_ID,
        scopes: GITHUB_OAUTH_SCOPES,
        provider: 'GitHub',
        fetch: options.fetch,
        toCredentials: ({ accessToken }) =>
          ok({ accessToken, apiBaseUrl: GITHUB_DOTCOM_API_BASE_URL }),
      });
    },
    credentialsFromOAuthToken({ accessToken, host }: OAuthAccessToken) {
      return { accessToken, apiBaseUrl: gitHubApiBaseUrlForHost(host) };
    },
  };
}

export const provider = registerIntegrationPluginBehavior(plugin, {
  auth: createGitHubAuthBehavior(),
});
