import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Issue } from '@shared/tasks';
import type { LinearIssue } from '@main/core/linear/LinearService';
import { rpc } from '@renderer/lib/ipc';

const INITIAL_FETCH_LIMIT = 50;
const SEARCH_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 300;

export const linearQueryKeys = {
  initial: () => ['linear:issues:initial'] as const,
  search: (term: string) => ['linear:issues:search', term] as const,
};

const toIssue = (raw: LinearIssue): Issue => ({
  provider: 'linear',
  identifier: raw.identifier,
  title: raw.title,
  url: raw.url ?? '',
  description: raw.description ?? undefined,
  status: raw.state?.name ?? undefined,
  assignees: raw.assignee
    ? [raw.assignee.name ?? raw.assignee.displayName ?? ''].filter(Boolean)
    : undefined,
  project: raw.project?.name ?? undefined,
  updatedAt: raw.updatedAt ?? undefined,
  fetchedAt: new Date().toISOString(),
});

export interface UseIssuesResult {
  issues: Issue[];
  isLoading: boolean;
  error: string | null;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  isSearching: boolean;
}

export function usePrefetchLinearIssues() {
  const queryClient = useQueryClient();

  return useCallback(() => {
    void queryClient.prefetchQuery({
      queryKey: linearQueryKeys.initial(),
      queryFn: async () => {
        const result = await rpc.linear.initialFetch(INITIAL_FETCH_LIMIT);
        if (!result?.success) {
          throw new Error(result?.error ?? 'Failed to load Linear issues.');
        }
        return (result.issues ?? []).map(toIssue);
      },
      staleTime: 60_000,
    });
  }, [queryClient]);
}

interface UseLinearIssuesOptions {
  enabled?: boolean;
}

export function useLinearIssues({ enabled = true }: UseLinearIssuesOptions = {}): UseIssuesResult {
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
    queryKey: linearQueryKeys.initial(),
    queryFn: async () => {
      const result = await rpc.linear.initialFetch(INITIAL_FETCH_LIMIT);
      if (!result?.success) {
        throw new Error(result?.error ?? 'Failed to load Linear issues.');
      }
      return (result.issues ?? []).map(toIssue);
    },
    staleTime: 60_000,
    enabled,
  });

  const isActiveSearch = debouncedTerm.trim().length > 0;

  const { data: searchIssues, isFetching: isSearching } = useQuery({
    queryKey: linearQueryKeys.search(debouncedTerm.trim()),
    queryFn: async () => {
      const result = await rpc.linear.searchIssues(debouncedTerm.trim(), SEARCH_LIMIT);
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
