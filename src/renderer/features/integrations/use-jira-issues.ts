import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Issue } from '@shared/tasks';
import type { JiraIssueSummary } from '@renderer/features/integrations/jira';
import { rpc } from '@renderer/lib/ipc';
import type { UseIssuesResult } from './use-linear-issues';

const INITIAL_FETCH_LIMIT = 50;
const SEARCH_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 300;

export const jiraQueryKeys = {
  initial: () => ['jira:issues:initial'] as const,
  search: (term: string) => ['jira:issues:search', term] as const,
};

const toIssue = (raw: JiraIssueSummary): Issue => ({
  provider: 'jira',
  identifier: raw.key,
  title: raw.summary,
  url: raw.url ?? '',
  description: raw.description ?? undefined,
  status: raw.status?.name ?? undefined,
  assignees: raw.assignee
    ? [raw.assignee.displayName ?? raw.assignee.name ?? ''].filter(Boolean)
    : undefined,
  project: raw.project?.name ?? undefined,
  updatedAt: raw.updatedAt ?? undefined,
  fetchedAt: new Date().toISOString(),
});

export function usePrefetchJiraIssues() {
  const queryClient = useQueryClient();

  return useCallback(() => {
    void queryClient.prefetchQuery({
      queryKey: jiraQueryKeys.initial(),
      queryFn: async () => {
        const result = await rpc.jira.initialFetch(INITIAL_FETCH_LIMIT);
        if (!result?.success) {
          throw new Error(result?.error ?? 'Failed to load Jira issues.');
        }
        return (result.issues ?? []).map(toIssue);
      },
      staleTime: 60_000,
    });
  }, [queryClient]);
}

interface UseJiraIssuesOptions {
  enabled?: boolean;
}

export function useJiraIssues({ enabled = true }: UseJiraIssuesOptions = {}): UseIssuesResult {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');

  useEffect(() => {
    const id = setTimeout(() => setDebouncedTerm(searchTerm), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchTerm]);

  const {
    data: initialIssues,
    isLoading: isLoadingInitial,
    error: initialError,
  } = useQuery({
    queryKey: jiraQueryKeys.initial(),
    queryFn: async () => {
      const result = await rpc.jira.initialFetch(INITIAL_FETCH_LIMIT);
      if (!result?.success) {
        throw new Error(result?.error ?? 'Failed to load Jira issues.');
      }
      return (result.issues ?? []).map(toIssue);
    },
    staleTime: 60_000,
    enabled,
  });

  const isActiveSearch = debouncedTerm.trim().length > 0;

  const { data: searchIssues, isFetching: isSearching } = useQuery({
    queryKey: jiraQueryKeys.search(debouncedTerm.trim()),
    queryFn: async () => {
      const result = await rpc.jira.searchIssues(debouncedTerm.trim(), SEARCH_LIMIT);
      if (result?.success) {
        return (result.issues ?? []).map(toIssue);
      }
      return [] as Issue[];
    },
    staleTime: 30_000,
    enabled: enabled && isActiveSearch,
    placeholderData: keepPreviousData,
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
