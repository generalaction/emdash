import { parseRepositoryRef } from '@emdash/core/primitives/repository/api';
import { useObserver } from 'mobx-react-lite';
import { useMemo } from 'react';
import { isIssueIntegration } from '@core/features/integrations/api/browser/integration-display';
import { useIntegrationsContext } from '@core/features/integrations/contributions/browser/integrations-provider';
import { getProjectSettingsStore } from '@core/features/projects/api/browser/stores/project-selectors';
import type { IssueProviderType } from '@core/primitives/issue-providers/api';
import { resolveProviderAccount } from '@core/primitives/project-settings/api';
import { providerAccountHostMatching } from '@core/primitives/project-settings/api/resolve-provider-account';
import { isProviderUsable, type ProviderContext } from '../../browser/provider-utils';

export interface UseConnectedIssueProvidersResult {
  connectedProviders: IssueProviderType[];
  hasAnyIssueIntegration: boolean;
  isProviderUsable: (provider: IssueProviderType) => boolean;
  isCheckingConnections: boolean;
  error: string | null;
}

export function useConnectedIssueProviders(
  context: ProviderContext = {}
): UseConnectedIssueProvidersResult {
  const { integrationAccounts, integrations, isLoadingAccounts, accountsError } =
    useIntegrationsContext();
  const projectChoices = useObserver(() =>
    context.projectId
      ? getProjectSettingsStore(context.projectId)?.durableDomains?.integrationAccounts.stored
      : undefined
  );
  const repositoryHost = parseRepositoryRef(context.repositoryUrl)?.host;

  const checkUsable = useMemo(
    () => (provider: IssueProviderType) => {
      const choice = projectChoices?.[provider];
      if (choice?.kind === 'none') return false;

      const integration = integrations.find((candidate) => candidate.id === provider);
      if (
        context.repositoryProvider &&
        (provider === 'github' || provider === 'gitlab') &&
        provider !== context.repositoryProvider
      ) {
        return false;
      }
      const accounts = integrationAccounts[provider] ?? [];
      const connected = integration?.issueCapabilities.requiresRepositoryUrl
        ? !!resolveProviderAccount(
            choice,
            accounts,
            providerAccountHostMatching(repositoryHost ?? null)
          ).value
        : accounts.length > 0 || choice?.kind === 'account';
      return (
        !!integration &&
        isProviderUsable(
          {
            connected,
            capabilities: integration.issueCapabilities,
          },
          context
        )
      );
    },
    [integrationAccounts, integrations, projectChoices, context, repositoryHost]
  );

  const connectedProviders = useMemo(
    () =>
      integrations
        .filter(isIssueIntegration)
        .map((integration) => integration.id)
        .filter(checkUsable),
    [checkUsable, integrations]
  );

  return {
    connectedProviders,
    hasAnyIssueIntegration: connectedProviders.length > 0,
    isProviderUsable: checkUsable,
    isCheckingConnections: isLoadingAccounts,
    error: accountsError?.message ?? null,
  };
}
