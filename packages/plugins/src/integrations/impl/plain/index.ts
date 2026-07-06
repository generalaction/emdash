import type { VerifyResult } from '../../capabilities/auth';
import { defineIntegrationPlugin, registerIntegrationPluginBehavior } from '../../plugin';
import { verifyPlainCredentials } from './client';
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
    async verify(_host, credentials): Promise<VerifyResult> {
      const result = await verifyPlainCredentials(credentials);
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
