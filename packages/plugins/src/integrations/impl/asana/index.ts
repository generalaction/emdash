import type { VerifyResult } from '../../capabilities/auth';
import { defineIntegrationPlugin, registerIntegrationPluginBehavior } from '../../plugin';
import { verifyAsanaCredentials } from './client';
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
    async verify(_host, credentials): Promise<VerifyResult> {
      const result = await verifyAsanaCredentials(credentials);
      if (!result.success)
        return {
          connected: false,
          error: result.error.message,
        };
      return {
        connected: true,
        ...result.data,
      };
    },
  },
});
