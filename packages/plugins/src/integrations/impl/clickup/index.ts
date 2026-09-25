import type { VerifyResult } from '../../capabilities/auth';
import { defineIntegrationPlugin, registerIntegrationPluginBehavior } from '../../plugin';
import { verifyClickUpCredentials } from './client';
import { icon } from './icon';
import { clickUpCredentialsSchema } from './types';

const plugin = defineIntegrationPlugin(
  {
    id: 'clickup',
    name: 'ClickUp',
    description: 'Work on ClickUp tickets',
    websiteUrl: 'https://clickup.com',
  },
  {
    auth: {
      methods: [
        {
          kind: 'form',
          fields: [
            {
              id: 'apiKey',
              label: 'Personal API token',
              secret: true,
              required: true,
              placeholder: 'ClickUp personal API token',
            },
            {
              id: 'workspaceId',
              label: 'Workspace ID',
              required: false,
              placeholder: 'Optional when you have one workspace',
            },
          ],
          help: 'Create a personal token in ClickUp Settings → Apps. Lists your open assigned tasks. Keyword search covers your 500 most recently updated open tasks; paste a task ID or URL to look up any accessible task in this workspace, including closed tasks.',
          helpUrl: 'https://developer.clickup.com/docs/authentication',
        },
      ],
    },
  },
  { icon }
);

export const provider = registerIntegrationPluginBehavior(plugin, {
  auth: {
    credentialsSchema: clickUpCredentialsSchema,
    async verify(_host, credentials): Promise<VerifyResult> {
      const result = await verifyClickUpCredentials(credentials);
      if (!result.success) return { connected: false, error: result.error.message };
      return { connected: true, ...result.data };
    },
  },
});
