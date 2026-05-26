import { useCallback, useMemo, useState } from 'react';
import { useIntegrationsContext } from '@renderer/features/integrations/integrations-provider';
import { ISSUE_PROVIDER_ORDER } from '@renderer/features/integrations/issue-provider-meta';
import { useIssues } from '@renderer/features/integrations/use-issues';
import { getRepositoryStore } from '@renderer/features/projects/stores/project-selectors';
import type { Issue } from '@shared/tasks';
import { isProviderUsable } from './issue-provider-usability';

export type UseIssueSearchResult = ReturnType<typeof useIssueSearch>;

function getPrioritySortValue(priority?: string): number {
  switch (priority?.toLowerCase()) {
    case 'urgent':
      return 0;
    case 'high':
      return 1;
    case 'medium':
      return 2;
    case 'low':
      return 3;
    default:
      return 4;
  }
}

function sortByPriority(issues: Issue[]): Issue[] {
  return [...issues].sort(
    (a, b) => getPrioritySortValue(a.priority) - getPrioritySortValue(b.priority)
  );
}

export function useIssueSearch(repositoryUrl: string, projectPath = '', projectId?: string) {
  const { connectionStatus, isCheckingConnections } = useIntegrationsContext();
  const context = useMemo(() => ({ projectPath, repositoryUrl }), [projectPath, repositoryUrl]);
  const githubIssueHost =
    (projectId ? getRepositoryStore(projectId)?.providerRepository?.host : null) ?? null;

  const [selectedIssueProvider, setSelectedIssueProvider] = useState<Issue['provider'] | null>(
    null
  );

  const connectedProviders = useMemo(
    () =>
      ISSUE_PROVIDER_ORDER.filter((provider) =>
        isProviderUsable(provider, connectionStatus[provider], context, githubIssueHost)
      ),
    [connectionStatus, context, githubIssueHost]
  );

  const hasAnyIntegration = connectedProviders.length > 0;

  const issueProvider = useMemo(() => {
    if (
      selectedIssueProvider &&
      isProviderUsable(
        selectedIssueProvider,
        connectionStatus[selectedIssueProvider],
        context,
        githubIssueHost
      )
    ) {
      return selectedIssueProvider;
    }

    return connectedProviders[0] ?? null;
  }, [connectedProviders, connectionStatus, context, githubIssueHost, selectedIssueProvider]);

  const issuesHook = useIssues(issueProvider, {
    projectId,
    repositoryUrl,
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
    (provider: Issue['provider']) =>
      !isProviderUsable(provider, connectionStatus[provider], context, githubIssueHost),
    [connectionStatus, context, githubIssueHost]
  );

  const isProviderLoading =
    (!!issueProvider && (issuesHook.isLoading || issuesHook.isSearching)) || isCheckingConnections;

  const issues = useMemo(
    () => (issueProvider === 'linear' ? sortByPriority(issuesHook.issues) : issuesHook.issues),
    [issueProvider, issuesHook.issues]
  );

  return {
    issues,
    issueProvider,
    hasAnyIntegration,
    isProviderLoading,
    isProviderDisabled,
    connectedProviderCount: connectedProviders.length,
    handleSetSearchTerm,
    setSelectedIssueProvider,
  };
}
