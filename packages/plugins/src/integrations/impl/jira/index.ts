import type { VerifyResult } from '../../capabilities/auth';
import { defineIntegrationPlugin, registerIntegrationPluginBehavior } from '../../plugin';
import { verifyJiraCredentials } from './client';
import { icon } from './icon';
import { jiraCredentialsSchema } from './types';

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
          id: 'basic',
          label: 'Email + API token',
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
        {
          kind: 'form',
          id: 'bearer',
          label: 'Bearer token',
          fields: [
            {
              id: 'siteUrl',
              label: 'Site URL',
              required: true,
              placeholder: 'https://your-domain.atlassian.net',
            },
            {
              id: 'accessToken',
              label: 'OAuth 2.0 access token',
              secret: true,
              required: true,
              placeholder: 'Jira OAuth 2.0 access token',
            },
          ],
          help: 'Use an OAuth 2.0 access token for Jira Cloud. Atlassian API tokens are not supported by this method.',
        },
      ],
    },
  },
  { icon }
);

export const provider = registerIntegrationPluginBehavior(plugin, {
  auth: {
    credentialsSchema: jiraCredentialsSchema,
    async verify(_host, credentials, methodId): Promise<VerifyResult> {
      const result = await verifyJiraCredentials(credentials, methodId);
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
