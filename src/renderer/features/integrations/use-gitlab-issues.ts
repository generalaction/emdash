import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Issue } from '@shared/tasks';
import type { GitLabIssueSummary } from '@renderer/features/integrations/gitlab';
import { rpc } from '@renderer/lib/ipc';
import type { UseIssuesResult } from './use-linear-issues';

const INITIAL_FETCH_LIMIT = 50;
const SEARCH_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 300;

export const gitlabQueryKeys = {
  initial: (projectPath: string) => ['gitlab:issues:initial', projectPath] as const,
  search: (projectPath: string, term: string) =>
    ['gitlab:issues:search', projectPath, term] as const,
};

const toIssue = (raw: GitLabIssueSummary): Issue => ({
  provider: 'gitlab',
  identifier: `#${raw.iid}`,
  title: raw.title,
  url: raw.webUrl ?? '',
  description: raw.description ?? undefined,
  status: raw.state ?? undefined,
  assignees: raw.assignee
    ? [raw.assignee.name || raw.assignee.username].filter(Boolean)
    : undefined,
  project: raw.project?.name ?? undefined,
  updatedAt: raw.updatedAt ?? undefined,
  fetchedAt: new Date().toISOString(),
});

interface UseGitLabIssuesOptions {
  projectPath?: string;
  enabled?: boolean;
}

export function usePrefetchGitLabIssues() {
  const queryClient = useQueryClient();

  return useCallback(
    (projectPath: string) => {
      if (!projectPath) return;
      void queryClient.prefetchQuery({
        queryKey: gitlabQueryKeys.initial(projectPath),
        queryFn: async () => {
          const result = await rpc.gitlab.initialFetch(projectPath, INITIAL_FETCH_LIMIT);
          if (!result?.success) {
            throw new Error(result?.error ?? 'Failed to load GitLab issues.');
          }
          return (result.issues ?? []).map(toIssue);
        },
        staleTime: 60_000,
      });
    },
    [queryClient]
  );
}

export function useGitLabIssues({
  projectPath = '',
  enabled = true,
}: UseGitLabIssuesOptions = {}): UseIssuesResult {
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
    queryKey: gitlabQueryKeys.initial(projectPath),
    queryFn: async () => {
      const result = await rpc.gitlab.initialFetch(projectPath, INITIAL_FETCH_LIMIT);
      if (!result?.success) {
        throw new Error(result?.error ?? 'Failed to load GitLab issues.');
      }
      return (result.issues ?? []).map(toIssue);
    },
    staleTime: 60_000,
    enabled: isReady,
  });

  const isActiveSearch = debouncedTerm.trim().length > 0;

  const { data: searchIssues, isFetching: isSearching } = useQuery({
    queryKey: gitlabQueryKeys.search(projectPath, debouncedTerm.trim()),
    queryFn: async () => {
      const result = await rpc.gitlab.searchIssues(projectPath, debouncedTerm.trim(), SEARCH_LIMIT);
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
