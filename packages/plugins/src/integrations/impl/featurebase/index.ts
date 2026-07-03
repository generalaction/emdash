import { defineIntegrationPlugin, registerIntegrationPluginBehavior } from '../../plugin';
import { toFeaturebaseErrorMessage, verifyFeaturebaseCredentials } from './client';
import { icon } from './icon';

const plugin = defineIntegrationPlugin(
  {
    id: 'featurebase',
    name: 'Featurebase',
    description: 'Work on Featurebase posts',
    websiteUrl: 'https://www.featurebase.app',
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
              placeholder: 'Featurebase API key',
            },
          ],
          help: 'Create an API key in Featurebase dashboard settings.',
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
        await verifyFeaturebaseCredentials(credentials);
        return { connected: true };
      } catch (error) {
        return {
          connected: false,
          error: toFeaturebaseErrorMessage(error, 'Failed to validate Featurebase API key.'),
        };
      }
    },
  },
});
