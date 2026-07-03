import { defineIntegrationPlugin, registerIntegrationPluginBehavior } from '../../plugin';
import {
  createGitHubClient,
  githubServiceHostForApiBaseUrl,
  readGitHubCredentials,
} from './client';
import { icon } from './icon';

const VERIFY_TIMEOUT_MS = 10_000;

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
          clientId: 'Ov23ligC35uHWopzCeWf',
          scopes: ['repo', 'read:user', 'read:org'],
        },
        { kind: 'cli-import', cli: 'gh' },
      ],
    },
  },
  { icon }
);

export const provider = registerIntegrationPluginBehavior(plugin, {
  auth: {
    async verify(host, credentials) {
      try {
        const parsed = readGitHubCredentials(credentials);
        const octokit = createGitHubClient(parsed);
        const { data } = await octokit.rest.users.getAuthenticated({
          request: { timeout: VERIFY_TIMEOUT_MS },
        });
        return {
          connected: true,
          account: {
            id: String(data.id),
            login: data.login,
            ...(data.avatar_url ? { avatarUrl: data.avatar_url } : {}),
            host: githubServiceHostForApiBaseUrl(parsed.apiBaseUrl),
          },
          displayName: data.name ?? data.login,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'GitHub verification failed.';
        host.log.warn(`GitHub credential verification failed: ${message}`);
        return { connected: false, error: message };
      }
    },
  },
});
