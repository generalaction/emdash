import { Gitlab } from 'lucide-react';
import type { IntegrationAuthUiProps } from '@core/features/integrations/api/browser/integration-auth-ui';
import { StandardIntegrationAuth } from '../contributions/browser/standard-integration-auth';

export function GitLabIntegrationAuth(props: IntegrationAuthUiProps) {
  return <StandardIntegrationAuth {...props} oauthIcon={Gitlab} />;
}
