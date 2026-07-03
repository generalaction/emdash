import { defineIntegrationPlugin, registerIntegrationPluginBehavior } from '../../plugin';
import { verifyJiraCredentials } from './client';
import { icon } from './icon';

const plugin = defineIntegrationPlugin(
  {
    id: 'jira',
    name: 'Jira',
    description: 'Work on Jira tickets',
    websiteUrl: 'https://www.atlassian.com/software/jira',
  },
  {
    auth: {
      methods: [
        {
          kind: 'form',
          fields: [
            {
              id: 'siteUrl',
              label: 'Site URL',
              required: true,
              placeholder: 'https://your-domain.atlassian.net',
            },
            {
              id: 'email',
              label: 'Email',
              required: true,
              placeholder: 'you@example.com',
            },
            {
              id: 'apiToken',
              label: 'API token',
              secret: true,
              required: true,
              placeholder: 'Jira API token',
            },
          ],
          help: 'Create an API token from your Atlassian account security settings.',
          helpUrl: 'https://id.atlassian.com/manage-profile/security/api-tokens',
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
        const status = await verifyJiraCredentials(credentials);
        return { connected: true, ...status };
      } catch (error) {
        return {
          connected: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  },
});
