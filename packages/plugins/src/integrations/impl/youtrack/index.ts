import type { VerifyResult } from '../../capabilities/auth';
import { defineIntegrationPlugin, registerIntegrationPluginBehavior } from '../../plugin';
import { verifyYouTrackCredentials } from './client';
import { icon } from './icon';
import { youTrackCredentialsSchema } from './types';

const plugin = defineIntegrationPlugin(
  {
    id: 'youtrack',
    name: 'YouTrack',
    description: 'Work on YouTrack tickets',
    websiteUrl: 'https://www.jetbrains.com/youtrack/',
  },
  {
    auth: {
      methods: [
        {
          kind: 'form',
          fields: [
            {
              id: 'instanceUrl',
              label: 'Instance URL',
              placeholder: 'https://your-team.youtrack.cloud',
              required: true,
            },
            {
              id: 'apiToken',
              label: 'Permanent token',
              placeholder: 'YouTrack permanent token',
              secret: true,
              required: true,
            },
          ],
          help: 'Use your Cloud or self-hosted instance URL, including any base path but without /api. Create a permanent token with the YouTrack scope in your profile.',
          helpUrl: 'https://www.jetbrains.com/help/youtrack/cloud/manage-permanent-token.html',
        },
      ],
    },
  },
  { icon }
);

export const provider = registerIntegrationPluginBehavior(plugin, {
  auth: {
    credentialsSchema: youTrackCredentialsSchema,
    async verify(_host, credentials): Promise<VerifyResult> {
      const result = await verifyYouTrackCredentials(credentials);
      if (!result.success) return { connected: false, error: result.error.message };
      return { connected: true, ...result.data };
    },
  },
});
