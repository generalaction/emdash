import type { VerifyResult } from '../../capabilities/auth';
import { defineIntegrationPlugin, registerIntegrationPluginBehavior } from '../../plugin';
import { verifyPlaneCredentials } from './client';
import { icon } from './icon';
import { PLANE_CLOUD_API_BASE_URL } from './types';

const plugin = defineIntegrationPlugin(
  {
    id: 'plane',
    name: 'Plane',
    description: 'Work on Plane work items',
    websiteUrl: 'https://plane.so',
  },
  {
    auth: {
      methods: [
        {
          kind: 'form',
          fields: [
            {
              id: 'apiBaseUrl',
              label: 'API base URL',
              required: true,
              placeholder: PLANE_CLOUD_API_BASE_URL,
              defaultValue: PLANE_CLOUD_API_BASE_URL,
            },
            {
              id: 'workspaceSlug',
              label: 'Workspace slug',
              required: true,
              placeholder: 'Workspace slug',
            },
            {
              id: 'apiKey',
              label: 'API key',
              secret: true,
              required: true,
              placeholder: 'Plane API key',
            },
          ],
          help: 'For Plane Cloud, use the default API base URL. For self-hosted Plane, enter your instance API base URL.',
        },
      ],
    },
  },
  { icon }
);

export const provider = registerIntegrationPluginBehavior(plugin, {
  auth: {
    async verify(_host, credentials): Promise<VerifyResult> {
      const result = await verifyPlaneCredentials(credentials);
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
