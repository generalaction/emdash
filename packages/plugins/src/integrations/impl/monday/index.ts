import type { VerifyResult } from '../../capabilities/auth';
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
          ],
          help: 'Generate a token from Monday.com Admin API settings.',
        },
      ],
    },
  },
  { icon }
);

export const provider = registerIntegrationPluginBehavior(plugin, {
  auth: {
    async verify(_host, credentials): Promise<VerifyResult> {
      const result = await verifyMondayCredentials(credentials);
      if (!result.success) return { connected: false, error: result.error.message };
      return { connected: true, ...result.data };
    },
  },
});
