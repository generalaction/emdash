import { useMemo } from 'react';
import type { IssueProviderType } from '@shared/issue-providers';
import { isIssueIntegration } from './integration-display';
import { useIntegrationsContext } from './integrations-provider';
import { isProviderUsable, type ProviderContext } from './provider-utils';

export interface UseConnectedIssueProvidersResult {
  connectedProviders: IssueProviderType[];
  hasAnyIssueIntegration: boolean;
  isProviderUsable: (provider: IssueProviderType) => boolean;
  isCheckingConnections: boolean;
}

export function useConnectedIssueProviders(
  context: ProviderContext = {}
): UseConnectedIssueProvidersResult {
  const { connectionStatus, integrations, isCheckingConnections } = useIntegrationsContext();

  const connectedProviders = useMemo(
    () =>
      integrations
        .filter(isIssueIntegration)
        .map((integration) => integration.id)
        .filter((provider) => isProviderUsable(connectionStatus[provider], context)),
    [connectionStatus, context, integrations]
  );

  const checkUsable = useMemo(
    () => (provider: IssueProviderType) => isProviderUsable(connectionStatus[provider], context),
    [connectionStatus, context]
  );

  return {
    connectedProviders,
    hasAnyIssueIntegration: connectedProviders.length > 0,
    isProviderUsable: checkUsable,
    isCheckingConnections,
  };
}
