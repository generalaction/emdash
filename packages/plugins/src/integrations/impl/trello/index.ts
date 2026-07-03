import { defineIntegrationPlugin, registerIntegrationPluginBehavior } from '../../plugin';
import { verifyTrelloCredentials } from './client';
import { icon } from './icon';

const plugin = defineIntegrationPlugin(
  {
    id: 'trello',
    name: 'Trello',
    description: 'Work on Trello cards',
    websiteUrl: 'https://trello.com',
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
              required: true,
              placeholder: 'API key',
            },
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
          help: 'Create a Power-Up at trello.com/power-ups/admin to get an API key, then generate a token from the API key page. Optionally add board URLs to choose exactly which boards Emdash searches; otherwise it checks the first 20 open boards.',
          helpUrl: 'https://trello.com/power-ups/admin',
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
        const result = await verifyTrelloCredentials(credentials);
        return { connected: true, ...result };
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to validate Trello credentials. Please try again.';
        return { connected: false, error: message };
      }
    },
  },
});
