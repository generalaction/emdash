import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Issue } from '@shared/tasks';
import type { PlainThreadSummary } from '@renderer/features/integrations/plain';
import { rpc } from '@renderer/lib/ipc';
import type { UseIssuesResult } from './use-linear-issues';

const INITIAL_FETCH_LIMIT = 50;
const SEARCH_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 300;

export const plainQueryKeys = {
  initial: () => ['plain:issues:initial'] as const,
  search: (term: string) => ['plain:issues:search', term] as const,
};

const toIssue = (raw: PlainThreadSummary): Issue => ({
  provider: 'plain',
  identifier: raw.ref ?? raw.id,
  title: raw.title,
  url: raw.url ?? '',
  description: raw.description ?? undefined,
  status: raw.status ?? undefined,
  updatedAt: raw.updatedAt ?? undefined,
  fetchedAt: new Date().toISOString(),
});

export function usePrefetchPlainIssues() {
  const queryClient = useQueryClient();

  return useCallback(() => {
    void queryClient.prefetchQuery({
      queryKey: plainQueryKeys.initial(),
      queryFn: async () => {
        const result = await rpc.plain.initialFetch(INITIAL_FETCH_LIMIT);
        if (!result?.success) {
          throw new Error(result?.error ?? 'Failed to load Plain threads.');
        }
        return (result.issues ?? []).map(toIssue);
      },
      staleTime: 60_000,
    });
  }, [queryClient]);
}

interface UsePlainIssuesOptions {
  enabled?: boolean;
}

export function usePlainIssues({ enabled = true }: UsePlainIssuesOptions = {}): UseIssuesResult {
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
    queryKey: plainQueryKeys.initial(),
    queryFn: async () => {
      const result = await rpc.plain.initialFetch(INITIAL_FETCH_LIMIT);
      if (!result?.success) {
        throw new Error(result?.error ?? 'Failed to load Plain threads.');
      }
      return (result.issues ?? []).map(toIssue);
    },
    staleTime: 60_000,
    enabled,
  });

  const isActiveSearch = debouncedTerm.trim().length >= 2;

  const { data: searchIssues, isFetching: isSearching } = useQuery({
    queryKey: plainQueryKeys.search(debouncedTerm.trim()),
    queryFn: async () => {
      const result = await rpc.plain.searchIssues(debouncedTerm.trim(), SEARCH_LIMIT);
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
