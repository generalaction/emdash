import { useCallback, useMemo, useState } from 'react';
import type { ConnectionStatus } from '@shared/issue-providers';
import type { Issue } from '@shared/tasks';
import { useIntegrationsContext } from '@renderer/features/integrations/integrations-provider';
import { ISSUE_PROVIDER_ORDER } from '@renderer/features/integrations/issue-provider-meta';
import { useIssues } from '@renderer/features/integrations/use-issues';

export type UseIssueSearchResult = ReturnType<typeof useIssueSearch>;

function isProviderUsable(
  status: ConnectionStatus | undefined,
  context: { projectPath?: string; nameWithOwner?: string }
): boolean {
  if (!status?.connected) return false;
  if (status.capabilities.requiresProjectPath && !context.projectPath) return false;
  if (status.capabilities.requiresNameWithOwner && !context.nameWithOwner) return false;
  return true;
}

export function useIssueSearch(nameWithOwner: string, projectPath = '', projectId?: string) {
  const { connectionStatus, isCheckingConnections } = useIntegrationsContext();
  const context = useMemo(() => ({ projectPath, nameWithOwner }), [projectPath, nameWithOwner]);

  const [selectedIssueProvider, setSelectedIssueProvider] = useState<Issue['provider'] | null>(
    null
  );

  const connectedProviders = useMemo(
    () =>
      ISSUE_PROVIDER_ORDER.filter((provider) =>
        isProviderUsable(connectionStatus[provider], context)
      ),
    [connectionStatus, context]
  );

  const hasAnyIntegration = connectedProviders.length > 0;

  const issueProvider = useMemo(() => {
    if (
      selectedIssueProvider &&
      isProviderUsable(connectionStatus[selectedIssueProvider], context)
    ) {
      return selectedIssueProvider;
    }

    return connectedProviders[0] ?? null;
  }, [connectedProviders, connectionStatus, context, selectedIssueProvider]);

  const issuesHook = useIssues(issueProvider, {
    projectId,
    nameWithOwner,
    projectPath,
    enabled: !!issueProvider,
  });

  const handleSetSearchTerm = useCallback(
    (term: string) => {
      if (!issueProvider) return;
      issuesHook.setSearchTerm(term);
    },
    [issueProvider, issuesHook]
  );

  const isProviderDisabled = useCallback(
    (provider: Issue['provider']) => !isProviderUsable(connectionStatus[provider], context),
    [connectionStatus, context]
  );

  const isProviderLoading =
    (!!issueProvider && (issuesHook.isLoading || issuesHook.isSearching)) || isCheckingConnections;

  return {
    issues: issuesHook.issues,
    issueProvider,
    hasAnyIntegration,
    isProviderLoading,
    isProviderDisabled,
    connectedProviderCount: connectedProviders.length,
    handleSetSearchTerm,
    setSelectedIssueProvider,
  };
}
