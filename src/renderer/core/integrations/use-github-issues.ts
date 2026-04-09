import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Issue } from '@shared/tasks';
import type { GitHubIssueSummary } from '@renderer/core/integrations/github';
import { rpc } from '../ipc';
import { UseIssuesResult } from './use-linear-issues';

const INITIAL_FETCH_LIMIT = 50;
const SEARCH_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 300;

export const githubQueryKeys = {
  initial: (nameWithOwner: string) => ['github:issues:initial', nameWithOwner] as const,
  search: (nameWithOwner: string, term: string) =>
    ['github:issues:search', nameWithOwner, term] as const,
};

const toIssue = (raw: GitHubIssueSummary): Issue => ({
  provider: 'github',
  identifier: `#${raw.number}`,
  title: raw.title,
  url: raw.url,
  description: raw.body ?? undefined,
  status: raw.state,
  assignees: raw.assignees.map((a) => a.login).filter(Boolean),
  updatedAt: raw.updatedAt ?? undefined,
  fetchedAt: new Date().toISOString(),
});

export function usePrefetchGitHubIssues() {
  const queryClient = useQueryClient();

  return useCallback(
    (nameWithOwner: string) => {
      if (!nameWithOwner) return;
      void queryClient.prefetchQuery({
        queryKey: githubQueryKeys.initial(nameWithOwner),
        queryFn: async () => {
          const result = await rpc.github.issuesList(nameWithOwner, INITIAL_FETCH_LIMIT);
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
  nameWithOwner: string;
  enabled?: boolean;
}

export function useGitHubIssues({
  nameWithOwner,
  enabled = true,
}: UseGitHubIssuesOptions): UseIssuesResult {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');

  const isReady = enabled && !!nameWithOwner;

  useEffect(() => {
    const id = setTimeout(() => setDebouncedTerm(searchTerm), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchTerm]);

  const {
    data: initialIssues,
    isLoading: isLoadingInitial,
    error: initialError,
  } = useQuery({
    queryKey: githubQueryKeys.initial(nameWithOwner),
    queryFn: async () => {
      const result = await rpc.github.issuesList(nameWithOwner, INITIAL_FETCH_LIMIT);
      if (!result?.success) {
        throw new Error(result?.error ?? 'Failed to load GitHub issues.');
      }
      return (result.issues ?? []).map(toIssue);
    },
    staleTime: 60_000,
    enabled: isReady,
  });

  const isActiveSearch = debouncedTerm.trim().length > 0;

  const { data: searchIssues, isFetching: isSearching } = useQuery({
    queryKey: githubQueryKeys.search(nameWithOwner, debouncedTerm.trim()),
    queryFn: async () => {
      const result = await rpc.github.issuesSearch(
        nameWithOwner,
        debouncedTerm.trim(),
        SEARCH_LIMIT
      );
      if (result?.success) {
        return (result.issues ?? []).map(toIssue);
      }
      return [] as Issue[];
    },
    staleTime: 30_000,
    enabled: isReady && isActiveSearch,
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
