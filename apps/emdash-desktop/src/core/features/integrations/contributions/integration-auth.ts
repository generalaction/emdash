import type { IntegrationAuthUiContribution } from '@core/features/integrations/api/browser/integration-auth-ui';
import { GitLabIntegrationAuth } from '../browser/gitlab-integration-auth';

export const gitlabIntegrationAuth: IntegrationAuthUiContribution = {
  integrationId: 'gitlab',
  methodKinds: ['oauth', 'oauth-device'],
  supportsReconnect: true,
  component: GitLabIntegrationAuth,
};
