import { useMemo } from 'react';
import type { IssueProviderType } from '@shared/issue-providers';
import { useIntegrationsContext } from './integrations-provider';
import { ISSUE_PROVIDER_ORDER } from './issue-provider-meta';
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
  const { connectionStatus, isCheckingConnections } = useIntegrationsContext();

  const connectedProviders = useMemo(
    () => ISSUE_PROVIDER_ORDER.filter((p) => isProviderUsable(connectionStatus[p], context)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [connectionStatus, context.projectPath, context.repositoryUrl]
  );

  const checkUsable = useMemo(
    () =>
      (provider: IssueProviderType) =>
        isProviderUsable(connectionStatus[provider], context),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [connectionStatus, context.projectPath, context.repositoryUrl]
  );

  return {
    connectedProviders,
    hasAnyIssueIntegration: connectedProviders.length > 0,
    isProviderUsable: checkUsable,
    isCheckingConnections,
  };
}
