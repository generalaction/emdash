import { defineIntegrationPlugin, registerIntegrationPluginBehavior } from '../../plugin';
import { PLANE_CLOUD_API_BASE_URL, toPlaneErrorMessage, verifyPlaneCredentials } from './client';
import { icon } from './icon';

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
    async verify(_host, credentials) {
      try {
        const result = await verifyPlaneCredentials(credentials);
        return { connected: true, ...result };
      } catch (error) {
        return {
          connected: false,
          error: toPlaneErrorMessage(error, 'Failed to validate Plane credentials.'),
        };
      }
    },
  },
});
