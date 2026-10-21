import type { IntegrationAuthUiContribution } from '@core/features/integrations/api/browser/integration-auth-ui';
import { DeviceFlowIntegrationAuth } from '../browser/device-flow-integration-auth';

export const gitlabIntegrationAuth: IntegrationAuthUiContribution = {
  integrationId: 'gitlab',
  methodKinds: ['oauth-device'],
  supportsReconnect: true,
  component: DeviceFlowIntegrationAuth,
};
