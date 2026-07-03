import { defineIntegrationPlugin, registerIntegrationPluginBehavior } from '../../plugin';
import { verifyLinearCredentials } from './client';
import { icon } from './icon';

const plugin = defineIntegrationPlugin(
  {
    id: 'linear',
    name: 'Linear',
    description: 'Work on Linear tickets',
    websiteUrl: 'https://linear.app',
  },
  {
    auth: {
      methods: [
        {
          kind: 'form',
          fields: [
            {
              id: 'apiKey',
              label: 'API key',
              secret: true,
              required: true,
              placeholder: 'Linear API key',
            },
          ],
          help: 'Create a personal API key in Linear under Account > Security & Access > Personal API keys.',
          helpUrl: 'https://linear.app/docs/api-and-webhooks',
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
        const status = await verifyLinearCredentials(credentials);
        return { connected: true, ...status };
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to validate Linear token. Please try again.';
        return { connected: false, error: message };
      }
    },
  },
});
