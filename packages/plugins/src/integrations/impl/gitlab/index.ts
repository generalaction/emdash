import { err, ok } from '@agent/shared';
import type { OAuthAccessToken, VerifyResult } from '../../capabilities/auth';
import {
  refreshOAuthToken,
  startDeviceAuthorizationSession,
  type FetchLike,
} from '../../helpers/oauth-device';
import { defineIntegrationPlugin, registerIntegrationPluginBehavior } from '../../plugin';
import { verifyGitLabCredentials } from './client';
import { icon } from './icon';
import { gitLabCredentialsSchema, gitLabOAuthCredentialsSchema } from './types';

/**
 * agent's OAuth application on gitlab.com, shared with the auth server. It is
 * not confidential: the server authenticates with its secret, while device
 * sign-in and refreshes on the desktop send only this ID.
 */
export const GITLAB_OAUTH_CLIENT_ID =
  '5426ca5d36a893cc469b0776a939b494d2b558053e3f0fcbff351f95973e5375';
export const GITLAB_OAUTH_SCOPES = ['api', 'read_user'];
const GITLAB_DOT_COM = 'https://gitlab.com';

const plugin = defineIntegrationPlugin(
  {
    id: 'gitlab',
    name: 'GitLab',
    description: 'Work on GitLab work items',
    websiteUrl: GITLAB_DOT_COM,
  },
  {
    auth: {
      methods: [
        { kind: 'oauth', providerId: 'gitlab' },
        {
          kind: 'oauth-device',
          clientId: GITLAB_OAUTH_CLIENT_ID,
          scopes: GITLAB_OAUTH_SCOPES,
        },
        {
          kind: 'form',
          fields: [
            {
              id: 'instanceUrl',
              label: 'Instance URL',
              required: true,
              placeholder: GITLAB_DOT_COM,
              defaultValue: GITLAB_DOT_COM,
            },
            {
              id: 'apiToken',
              label: 'Personal access token',
              secret: true,
              required: true,
              placeholder: 'Personal access token',
            },
          ],
          help: 'Create a personal access token with api scope in GitLab settings.',
        },
      ],
    },
  },
  { icon }
);

export function createGitLabAuthBehavior(options: { fetch?: FetchLike } = {}) {
  const tokenUrl = `${GITLAB_DOT_COM}/oauth/token`;
  return {
    credentialsSchema: gitLabCredentialsSchema,
    async verify(_host: unknown, credentials: Parameters<typeof verifyGitLabCredentials>[0]) {
      const result = await verifyGitLabCredentials(credentials);
      if (!result.success)
        return { connected: false, error: result.error.message } satisfies VerifyResult;
      return { connected: true, ...result.data } satisfies VerifyResult;
    },
    async startDeviceAuthorization() {
      return await startDeviceAuthorizationSession({
        deviceAuthorizationUrl: `${GITLAB_DOT_COM}/oauth/authorize_device`,
        tokenUrl,
        clientId: GITLAB_OAUTH_CLIENT_ID,
        scopes: GITLAB_OAUTH_SCOPES,
        provider: 'GitLab',
        fetch: options.fetch,
        toCredentials({ accessToken, refreshToken, expiresAt }) {
          if (!refreshToken || expiresAt === undefined) {
            return err({
              type: 'generic' as const,
              message: 'GitLab did not return a refreshable token.',
            });
          }
          return ok({ instanceUrl: GITLAB_DOT_COM, accessToken, refreshToken, expiresAt });
        },
      });
    },
    credentialsFromOAuthToken({ accessToken, expiresAt, host }: OAuthAccessToken) {
      return {
        instanceUrl: `https://${host}`,
        accessToken,
        ...(expiresAt !== undefined ? { expiresAt } : {}),
      };
    },
    async refreshCredentials(
      _host: unknown,
      credentials: Parameters<typeof verifyGitLabCredentials>[0],
      now: number
    ) {
      const oauth = gitLabOAuthCredentialsSchema.safeParse(credentials);
      if (!oauth.success || !oauth.data.refreshToken || oauth.data.instanceUrl !== GITLAB_DOT_COM) {
        return ok(undefined);
      }
      const tokens = await refreshOAuthToken({
        url: tokenUrl,
        clientId: GITLAB_OAUTH_CLIENT_ID,
        refreshToken: oauth.data.refreshToken,
        provider: 'GitLab',
        fetch: options.fetch,
        now: () => now,
      });
      if (!tokens.success) return tokens;
      return ok({
        instanceUrl: oauth.data.instanceUrl,
        accessToken: tokens.data.accessToken,
        refreshToken: tokens.data.refreshToken ?? oauth.data.refreshToken,
        expiresAt: tokens.data.expiresAt ?? now + 2 * 60 * 60 * 1000,
      });
    },
  };
}

export const provider = registerIntegrationPluginBehavior(plugin, {
  auth: createGitLabAuthBehavior(),
});
