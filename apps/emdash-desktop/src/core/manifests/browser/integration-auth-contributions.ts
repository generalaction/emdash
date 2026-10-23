import { githubIntegrationAuth } from '@core/features/github/contributions/integration-auth';
import type { IntegrationAuthUiContribution } from '@core/features/integrations/api/browser/integration-auth-ui';
import type { IntegrationProviderDescriptor } from '@core/features/integrations/api/contract';
import { gitlabIntegrationAuth } from '@core/features/integrations/contributions/integration-auth';

const integrationAuthContributions: IntegrationAuthUiContribution[] = [
  githubIntegrationAuth,
  gitlabIntegrationAuth,
];

export function getIntegrationAuthUi(metadata: Pick<IntegrationProviderDescriptor, 'id' | 'auth'>) {
  return integrationAuthContributions.find(
    (contribution) =>
      contribution.integrationId === metadata.id &&
      metadata.auth.methods.some((method) => contribution.methodKinds.includes(method.kind))
  );
}

export function supportsIntegrationReconnect(
  metadata: Pick<IntegrationProviderDescriptor, 'id' | 'auth'>
): boolean {
  return (
    metadata.auth.methods.some((method) => method.kind === 'form') ||
    getIntegrationAuthUi(metadata)?.supportsReconnect === true
  );
}
