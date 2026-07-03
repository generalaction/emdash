import { defineIntegrationPlugin, registerIntegrationPluginBehavior } from '../../plugin';
import { toGitLabErrorMessage, verifyGitLabCredentials } from './client';
import { icon } from './icon';

const plugin = defineIntegrationPlugin(
  {
    id: 'gitlab',
    name: 'GitLab',
    description: 'Work on GitLab issues',
    websiteUrl: 'https://gitlab.com',
  },
  {
    auth: {
      methods: [
        {
          kind: 'form',
          fields: [
            {
              id: 'instanceUrl',
              label: 'Instance URL',
              required: true,
              placeholder: 'https://gitlab.com',
              defaultValue: 'https://gitlab.com',
            },
            {
              id: 'apiToken',
              label: 'Personal access token',
              secret: true,
              required: true,
              placeholder: 'Personal access token',
            },
          ],
          help: 'Create a personal access token with read_api scope in GitLab settings.',
        },
      ],
    },
  },
  { icon }
);

export const provider = registerIntegrationPluginBehavior(plugin, {
  auth: {
    async verify(_host, credentials) {
      try {
        const result = await verifyGitLabCredentials(credentials);
        return { connected: true, ...result };
      } catch (error) {
        return {
          connected: false,
          error: toGitLabErrorMessage(error, 'Failed to validate GitLab credentials.'),
        };
      }
    },
  },
});
