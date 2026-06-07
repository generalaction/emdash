import { useCallback, useMemo, useState } from 'react';
import { useConnectedIssueProviders } from '@renderer/features/integrations/use-connected-issue-providers';
import { useIssues } from '@renderer/features/integrations/use-issues';
import { getProjectViewStore } from '@renderer/features/projects/stores/project-selectors';
import type { LinkedIssue } from '@shared/core/linked-issue';

export type UseIssueSearchResult = ReturnType<typeof useIssueSearch>;

export function useIssueSearch(repositoryUrl: string, projectPath = '', projectId?: string) {
  const context = useMemo(() => ({ projectPath, repositoryUrl }), [projectPath, repositoryUrl]);

  const { connectedProviders, hasAnyIssueIntegration, isProviderUsable, isCheckingConnections } =
    useConnectedIssueProviders(context);

  const projectView = projectId ? getProjectViewStore(projectId) : undefined;

  const [localProvider, setLocalProvider] = useState<LinkedIssue['provider'] | null>(null);

  // When a project is available, read from the MobX-observable store (auto-tracked in observer
  // components) so the selection persists across modal opens. Fall back to local state otherwise.
  const selectedIssueProvider = projectView?.selectedIssueProvider ?? localProvider;

  const setSelectedIssueProvider = useCallback(
    (provider: LinkedIssue['provider'] | null) => {
      if (projectView) {
        projectView.setSelectedIssueProvider(provider);
      } else {
        setLocalProvider(provider);
      }
    },
    [projectView]
  );

  const issueProvider = useMemo(() => {
    if (selectedIssueProvider && isProviderUsable(selectedIssueProvider)) {
      return selectedIssueProvider;
    }

    return connectedProviders[0] ?? null;
  }, [connectedProviders, isProviderUsable, selectedIssueProvider]);

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
    (provider: LinkedIssue['provider']) => !isProviderUsable(provider),
    [isProviderUsable]
  );

  const isProviderLoading =
    (!!issueProvider && (issuesHook.isLoading || issuesHook.isSearching)) || isCheckingConnections;

  return {
    issues: issuesHook.issues,
    issueProvider,
    hasAnyIntegration: hasAnyIssueIntegration,
    isProviderLoading,
    isProviderDisabled,
    connectedProviderCount: connectedProviders.length,
    handleSetSearchTerm,
    setSelectedIssueProvider,
  };
}
