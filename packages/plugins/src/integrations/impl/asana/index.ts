import { defineIntegrationPlugin, registerIntegrationPluginBehavior } from '../../plugin';
import { toAsanaErrorMessage, verifyAsanaCredentials } from './client';
import { icon } from './icon';

const plugin = defineIntegrationPlugin(
  {
    id: 'asana',
    name: 'Asana',
    description: 'Work on Asana tasks',
    websiteUrl: 'https://asana.com',
  },
  {
    auth: {
      methods: [
        {
          kind: 'form',
          fields: [
            {
              id: 'accessToken',
              label: 'Personal access token',
              secret: true,
              required: true,
              placeholder: 'Asana personal access token',
            },
          ],
          help: 'Open Asana and got to My Settings > Apps, click on Developer Apps and create a new Personal Access Token.',
          helpUrl: 'https://developers.asana.com/docs/personal-access-token',
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
        const result = await verifyAsanaCredentials(credentials);
        return { connected: true, ...result };
      } catch (error) {
        return {
          connected: false,
          error: toAsanaErrorMessage(error, 'Failed to validate Asana access token.'),
        };
      }
    },
  },
});
