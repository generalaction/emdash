import { defineIntegrationPlugin, registerIntegrationPluginBehavior } from '../../plugin';
import { toPlainErrorMessage, validatePlainCredentials } from './client';
import { icon } from './icon';

const plugin = defineIntegrationPlugin(
  {
    id: 'plain',
    name: 'Plain',
    description: 'Work on Plain threads',
    websiteUrl: 'https://www.plain.com',
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
              placeholder: 'Plain API key',
            },
          ],
          help: 'Create an API key from Plain settings.',
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
        await validatePlainCredentials(credentials);
        return { connected: true };
      } catch (error) {
        return {
          connected: false,
          error: toPlainErrorMessage(error, 'Failed to validate Plain API key.'),
        };
      }
    },
  },
});
