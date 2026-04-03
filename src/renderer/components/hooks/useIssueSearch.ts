import { useCallback, useMemo, useState } from 'react';
import type { Issue } from '@shared/tasks';
import { useGitHubIssues } from '@renderer/core/integrations/use-github-issues';
import { useGitLabIssues } from '@renderer/core/integrations/use-gitlab-issues';
import { useJiraIssues } from '@renderer/core/integrations/use-jira-issues';
import { useLinearIssues } from '@renderer/core/integrations/use-linear-issues';
import { usePlainIssues } from '@renderer/core/integrations/use-plain-issues';
import { useIntegrationStatus } from './useIntegrationStatus';

export type UseIssueSearchResult = ReturnType<typeof useIssueSearch>;

export function useIssueSearch(nameWithOwner: string, projectPath = '') {
  const {
    isLinearConnected,
    isGithubConnected,
    isJiraConnected,
    isGitlabConnected,
    isPlainConnected,
  } = useIntegrationStatus();
  const canUseGitlab = isGitlabConnected === true && !!projectPath;
  const [selectedIssueProvider, setSelectedIssueProvider] = useState<Issue['provider'] | null>(
    null
  );

  const linearIssues = useLinearIssues({ enabled: isLinearConnected === true });
  const githubIssues = useGitHubIssues({
    nameWithOwner,
    enabled: isGithubConnected && !!nameWithOwner,
  });
  const jiraIssues = useJiraIssues({ enabled: isJiraConnected === true });
  const gitlabIssues = useGitLabIssues({
    projectPath,
    enabled: canUseGitlab,
  });
  const plainIssues = usePlainIssues({ enabled: isPlainConnected === true });

  const hasAnyIntegration = !!(
    isLinearConnected ||
    isGithubConnected ||
    isJiraConnected ||
    canUseGitlab ||
    isPlainConnected
  );

  const issueProvider = useMemo(() => {
    if (!selectedIssueProvider) {
      if (isLinearConnected) return 'linear' as const;
      if (isGithubConnected) return 'github' as const;
      if (isJiraConnected) return 'jira' as const;
      if (canUseGitlab) return 'gitlab' as const;
      if (isPlainConnected) return 'plain' as const;
    }
    return selectedIssueProvider;
  }, [
    isLinearConnected,
    isGithubConnected,
    isJiraConnected,
    canUseGitlab,
    isPlainConnected,
    selectedIssueProvider,
  ]);

  const handleSetSearchTerm = useCallback(
    (term: string) => {
      switch (issueProvider) {
        case 'linear':
          return linearIssues.setSearchTerm(term);
        case 'github':
          return githubIssues.setSearchTerm(term);
        case 'jira':
          return jiraIssues.setSearchTerm(term);
        case 'gitlab':
          return gitlabIssues.setSearchTerm(term);
        case 'plain':
          return plainIssues.setSearchTerm(term);
        default:
          return;
      }
    },
    [issueProvider, linearIssues, githubIssues, jiraIssues, gitlabIssues, plainIssues]
  );

  const isProviderDisabled = useCallback(
    (provider: Issue['provider']) => {
      if (!hasAnyIntegration) return true;
      if (provider === 'linear') return !isLinearConnected;
      if (provider === 'github') return !isGithubConnected;
      if (provider === 'jira') return !isJiraConnected;
      if (provider === 'gitlab') return !canUseGitlab;
      if (provider === 'plain') return !isPlainConnected;
      return false;
    },
    [
      hasAnyIntegration,
      isLinearConnected,
      isGithubConnected,
      isJiraConnected,
      canUseGitlab,
      isPlainConnected,
    ]
  );

  const issues = useMemo(() => {
    if (!issueProvider) return [];
    if (issueProvider === 'linear') return linearIssues.issues;
    if (issueProvider === 'github') return githubIssues.issues;
    if (issueProvider === 'jira') return jiraIssues.issues;
    if (issueProvider === 'gitlab') return gitlabIssues.issues;
    if (issueProvider === 'plain') return plainIssues.issues;
    return [];
  }, [
    issueProvider,
    linearIssues.issues,
    githubIssues.issues,
    jiraIssues.issues,
    gitlabIssues.issues,
    plainIssues.issues,
  ]);

  const activeHook =
    issueProvider === 'linear'
      ? linearIssues
      : issueProvider === 'github'
        ? githubIssues
        : issueProvider === 'jira'
          ? jiraIssues
          : issueProvider === 'gitlab'
            ? gitlabIssues
            : plainIssues;

  const isProviderLoading = !!issueProvider && (activeHook.isLoading || activeHook.isSearching);

  const connectedProviderCount = [
    isLinearConnected,
    isGithubConnected,
    isJiraConnected,
    canUseGitlab,
    isPlainConnected,
  ].filter(Boolean).length;

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
