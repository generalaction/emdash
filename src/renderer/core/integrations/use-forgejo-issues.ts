import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Issue } from '@shared/tasks';
import type { ForgejoIssueSummary } from '@renderer/core/integrations/forgejo';
import { rpc } from '../ipc';
import type { UseIssuesResult } from './use-linear-issues';

const INITIAL_FETCH_LIMIT = 50;
const SEARCH_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 300;

export const forgejoQueryKeys = {
  initial: (projectPath: string) => ['forgejo:issues:initial', projectPath] as const,
  search: (projectPath: string, term: string) =>
    ['forgejo:issues:search', projectPath, term] as const,
};

const toIssue = (raw: ForgejoIssueSummary): Issue => ({
  provider: 'forgejo',
  identifier: `#${raw.number}`,
  title: raw.title,
  url: raw.htmlUrl ?? '',
  description: raw.description ?? undefined,
  status: raw.state ?? undefined,
  assignees: raw.assignee
    ? [raw.assignee.name || raw.assignee.username].filter(Boolean)
    : undefined,
  project: raw.repo ?? undefined,
  updatedAt: raw.updatedAt ?? undefined,
  fetchedAt: new Date().toISOString(),
});

interface UseForgejoIssuesOptions {
  projectPath?: string;
  enabled?: boolean;
}

export function usePrefetchForgejoIssues() {
  const queryClient = useQueryClient();

  return useCallback(
    (projectPath: string) => {
      if (!projectPath) return;
      void queryClient.prefetchQuery({
        queryKey: forgejoQueryKeys.initial(projectPath),
        queryFn: async () => {
          const result = await rpc.forgejo.initialFetch(projectPath, INITIAL_FETCH_LIMIT);
          if (!result?.success) {
            throw new Error(result?.error ?? 'Failed to load Forgejo issues.');
          }
          return (result.issues ?? []).map(toIssue);
        },
        staleTime: 60_000,
      });
    },
    [queryClient]
  );
}

export function useForgejoIssues({
  projectPath = '',
  enabled = true,
}: UseForgejoIssuesOptions = {}): UseIssuesResult {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');

  useEffect(() => {
    const id = setTimeout(() => setDebouncedTerm(searchTerm), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchTerm]);

  const isReady = enabled && !!projectPath;

  const {
    data: initialIssues,
    isLoading: isLoadingInitial,
    error: initialError,
  } = useQuery({
    queryKey: forgejoQueryKeys.initial(projectPath),
    queryFn: async () => {
      const result = await rpc.forgejo.initialFetch(projectPath, INITIAL_FETCH_LIMIT);
      if (!result?.success) {
        throw new Error(result?.error ?? 'Failed to load Forgejo issues.');
      }
      return (result.issues ?? []).map(toIssue);
    },
    staleTime: 60_000,
    enabled: isReady,
  });

  const isActiveSearch = debouncedTerm.trim().length > 0;

  const { data: searchIssues, isFetching: isSearching } = useQuery({
    queryKey: forgejoQueryKeys.search(projectPath, debouncedTerm.trim()),
    queryFn: async () => {
      const result = await rpc.forgejo.searchIssues(
        projectPath,
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
