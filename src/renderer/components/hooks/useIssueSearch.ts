import { useCallback, useMemo, useState } from 'react';
import type { Issue } from '@shared/tasks';
import { useGitHubIssues } from '@renderer/core/integrations/use-github-issues';
import { useJiraIssues } from '@renderer/core/integrations/use-jira-issues';
import { useLinearIssues } from '@renderer/core/integrations/use-linear-issues';
import { useIntegrationStatus } from './useIntegrationStatus';

export type UseIssueSearchResult = ReturnType<typeof useIssueSearch>;

export function useIssueSearch(nameWithOwner: string) {
  const { isLinearConnected, isGithubConnected, isJiraConnected } = useIntegrationStatus();
  const [selectedIssueProvider, setSelectedIssueProvider] = useState<Issue['provider'] | null>(
    null
  );

  const linearIssues = useLinearIssues({ enabled: isLinearConnected === true });
  const githubIssues = useGitHubIssues({
    nameWithOwner,
    enabled: isGithubConnected && !!nameWithOwner,
  });
  const jiraIssues = useJiraIssues({ enabled: isJiraConnected === true });

  const hasAnyIntegration = !!(isLinearConnected || isGithubConnected || isJiraConnected);

  const issueProvider = useMemo(() => {
    if (!selectedIssueProvider) {
      if (isLinearConnected) return 'linear' as const;
      if (isGithubConnected) return 'github' as const;
      if (isJiraConnected) return 'jira' as const;
    }
    return selectedIssueProvider;
  }, [isLinearConnected, isGithubConnected, isJiraConnected, selectedIssueProvider]);

  const handleSetSearchTerm = useCallback(
    (term: string) => {
      switch (issueProvider) {
        case 'linear':
          return linearIssues.setSearchTerm(term);
        case 'github':
          return githubIssues.setSearchTerm(term);
        case 'jira':
          return jiraIssues.setSearchTerm(term);
        default:
          return;
      }
    },
    [issueProvider, linearIssues, githubIssues, jiraIssues]
  );

  const isProviderDisabled = useCallback(
    (provider: Issue['provider']) => {
      if (!hasAnyIntegration) return true;
      if (provider === 'linear') return !isLinearConnected;
      if (provider === 'github') return !isGithubConnected;
      if (provider === 'jira') return !isJiraConnected;
      return false;
    },
    [hasAnyIntegration, isLinearConnected, isGithubConnected, isJiraConnected]
  );

  const issues = useMemo(() => {
    if (!issueProvider) return [];
    if (issueProvider === 'linear') return linearIssues.issues;
    if (issueProvider === 'github') return githubIssues.issues;
    if (issueProvider === 'jira') return jiraIssues.issues;
    return [];
  }, [issueProvider, linearIssues.issues, githubIssues.issues, jiraIssues.issues]);

  const activeHook =
    issueProvider === 'linear'
      ? linearIssues
      : issueProvider === 'github'
        ? githubIssues
        : jiraIssues;

  const isProviderLoading = !!issueProvider && (activeHook.isLoading || activeHook.isSearching);

  const connectedProviderCount = [isLinearConnected, isGithubConnected, isJiraConnected].filter(
    Boolean
  ).length;

  return {
    issues,
    issueProvider,
    hasAnyIntegration,
    isProviderLoading,
    isProviderDisabled,
    connectedProviderCount,
    handleSetSearchTerm,
    setSelectedIssueProvider,
  };
}
