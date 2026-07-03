import { defineIntegrationPlugin, registerIntegrationPluginBehavior } from '../../plugin';
import { toForgejoErrorMessage, verifyForgejoCredentials } from './client';
import { icon } from './icon';

const plugin = defineIntegrationPlugin(
  {
    id: 'forgejo',
    name: 'Forgejo',
    description: 'Work on Forgejo issues',
    websiteUrl: 'https://forgejo.org',
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
              placeholder: 'https://forgejo.example.com',
            },
            {
              id: 'apiToken',
              label: 'API token',
              secret: true,
              required: true,
              placeholder: 'API token',
            },
          ],
          help: 'Create an API token in your Forgejo user settings under Applications.',
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
        const result = await verifyForgejoCredentials(credentials);
        return { connected: true, ...result };
      } catch (error) {
        return {
          connected: false,
          error: toForgejoErrorMessage(error, 'Failed to validate Forgejo credentials.'),
        };
      }
    },
  },
});
