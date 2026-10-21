import type { IntegrationAuthUiContribution } from '@core/features/integrations/api/browser/integration-auth-ui';
import { GitHubIntegrationAuth } from '../browser/github-integration-auth';

export const githubIntegrationAuth: IntegrationAuthUiContribution = {
  integrationId: 'github',
  methodKinds: ['oauth', 'oauth-device', 'cli-import'],
  supportsReconnect: false,
  component: GitHubIntegrationAuth,
};
