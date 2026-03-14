import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Issue } from '@shared/tasks';
import { rpc } from '../lib/ipc';
import type { GitHubIssueSummary } from '../types/github';
import type { UseIssuesResult } from './use-linear-issues';

const INITIAL_FETCH_LIMIT = 50;
const SEARCH_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 300;

export const githubQueryKeys = {
  initial: (projectPath: string) => ['github:issues:initial', projectPath] as const,
  search: (projectPath: string, term: string) =>
    ['github:issues:search', projectPath, term] as const,
};

const toIssue = (raw: GitHubIssueSummary): Issue => ({
  provider: 'github',
  identifier: `#${raw.number}`,
  title: raw.title,
  url: raw.url ?? '',
  description: raw.body ?? undefined,
  status: raw.state ?? undefined,
  assignees: raw.assignees
    ? raw.assignees.map((a) => a.login ?? a.name ?? '').filter(Boolean)
    : undefined,
  updatedAt: raw.updatedAt ?? undefined,
  fetchedAt: new Date().toISOString(),
});

export function usePrefetchGitHubIssues() {
  const queryClient = useQueryClient();

  return useCallback(
    (projectPath: string) => {
      if (!projectPath) return;
      void queryClient.prefetchQuery({
        queryKey: githubQueryKeys.initial(projectPath),
        queryFn: async () => {
          const result = await rpc.github.issuesList(projectPath, INITIAL_FETCH_LIMIT);
          if (!result?.success) {
            throw new Error(result?.error ?? 'Failed to load GitHub issues.');
          }
          return (result.issues ?? []).map(toIssue);
        },
        staleTime: 60_000,
      });
    },
    [queryClient]
  );
}

interface UseGitHubIssuesOptions {
  projectPath: string;
  enabled?: boolean;
}

export function useGitHubIssues({
  projectPath,
  enabled = true,
}: UseGitHubIssuesOptions): UseIssuesResult {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');

  const isReady = enabled && !!projectPath;

  useEffect(() => {
    const id = setTimeout(() => setDebouncedTerm(searchTerm), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchTerm]);

  const {
    data: initialIssues,
    isLoading: isLoadingInitial,
    error: initialError,
  } = useQuery({
    queryKey: githubQueryKeys.initial(projectPath),
    queryFn: async () => {
      const result = await rpc.github.issuesList(projectPath, INITIAL_FETCH_LIMIT);
      if (!result?.success) {
        throw new Error(result?.error ?? 'Failed to load GitHub issues.');
      }
      void (async () => {
        const { captureTelemetry } = await import('../lib/telemetryClient');
        captureTelemetry('github_issues_searched');
      })();
      return (result.issues ?? []).map(toIssue);
    },
    staleTime: 60_000,
    enabled: isReady,
  });

  const isActiveSearch = debouncedTerm.trim().length > 0;

  const { data: searchIssues, isFetching: isSearching } = useQuery({
    queryKey: githubQueryKeys.search(projectPath, debouncedTerm.trim()),
    queryFn: async () => {
      const result = await rpc.github.issuesSearch(projectPath, debouncedTerm.trim(), SEARCH_LIMIT);
      if (result?.success) {
        void (async () => {
          const { captureTelemetry } = await import('../lib/telemetryClient');
          captureTelemetry('github_issue_selected');
        })();
        return (result.issues ?? []).map(toIssue);
      }
      return [] as Issue[];
    },
    staleTime: 30_000,
    enabled: isReady && isActiveSearch,
    placeholderData: [],
  });

  const issues = useMemo<Issue[]>(() => {
    if (isActiveSearch) return searchIssues ?? [];
    return initialIssues ?? [];
  }, [isActiveSearch, searchIssues, initialIssues]);

  const error = initialError instanceof Error ? initialError.message : null;

  return {
    issues,
    isLoading: isLoadingInitial,
    error,
    searchTerm,
    setSearchTerm,
    isSearching: isActiveSearch && isSearching,
  };
}
