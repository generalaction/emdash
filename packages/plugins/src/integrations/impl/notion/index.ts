import type { VerifyResult } from '../../capabilities/auth';
import { defineIntegrationPlugin, registerIntegrationPluginBehavior } from '../../plugin';
import { verifyNotionCredentials } from './client';
import { icon } from './icon';

const plugin = defineIntegrationPlugin(
  {
    id: 'notion',
    name: 'Notion',
    description: 'Connect your Notion workspace',
    websiteUrl: 'https://www.notion.so',
  },
  {
    auth: {
      methods: [
        {
          kind: 'form',
          fields: [
            {
              id: 'apiToken',
              label: 'Integration token',
              secret: true,
              required: true,
              placeholder: 'ntn_…',
            },
          ],
          help: 'Create a Notion internal integration token or personal access token, then share the pages you want Emdash to access with that connection.',
          helpUrl: 'https://developers.notion.com/guides/get-started/authorization',
        },
      ],
    },
  },
  { icon }
);

export const provider = registerIntegrationPluginBehavior(plugin, {
  auth: {
    async verify(_host, credentials): Promise<VerifyResult> {
      const result = await verifyNotionCredentials(credentials);
      if (!result.success) return { connected: false, error: result.error.message };
      return { connected: true, ...result.data };
    },
  },
});
