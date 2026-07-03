import { defineIntegrationPlugin, registerIntegrationPluginBehavior } from '../../plugin';
import { verifyMondayCredentials } from './client';
import { icon } from './icon';

const plugin = defineIntegrationPlugin(
  {
    id: 'monday',
    name: 'Monday.com',
    description: 'Work on Monday.com items',
    websiteUrl: 'https://monday.com',
  },
  {
    auth: {
      methods: [
        {
          kind: 'form',
          fields: [
            {
              id: 'apiToken',
              label: 'API token',
              secret: true,
              required: true,
              placeholder: 'API token',
            },
            {
              id: 'boardUrls',
              label: 'Board URLs',
              required: false,
              placeholder: 'Board URLs (optional, comma-separated)',
            },
          ],
          help: 'Generate a token from Monday.com Admin API settings. Optionally add board URLs to choose exactly which boards Emdash searches; otherwise it checks the first 20 accessible boards.',
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
        const result = await verifyMondayCredentials(credentials);
        return { connected: true, ...result };
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to validate Monday.com token. Please try again.';
        return { connected: false, error: message };
      }
    },
  },
});
