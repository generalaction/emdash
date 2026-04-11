import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { IssueProviderType } from '@shared/issue-providers';
import type { Issue } from '@shared/tasks';
import { rpc } from '@renderer/lib/ipc';

const INITIAL_FETCH_LIMIT = 50;
const SEARCH_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 300;

const SEARCH_MIN_LENGTH_BY_PROVIDER: Partial<Record<IssueProviderType, number>> = {
  plain: 2,
};

export interface UseIssuesResult {
  issues: Issue[];
  isLoading: boolean;
  error: string | null;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  isSearching: boolean;
}

interface UseIssuesOptions {
  projectPath?: string;
  nameWithOwner?: string;
  enabled?: boolean;
  initialLimit?: number;
  searchLimit?: number;
}

function getSearchMinLength(provider: IssueProviderType | null): number {
  if (!provider) return 1;
  return SEARCH_MIN_LENGTH_BY_PROVIDER[provider] ?? 1;
}

export function useIssues(
  provider: IssueProviderType | null,
  {
    projectPath,
    nameWithOwner,
    enabled = true,
    initialLimit = INITIAL_FETCH_LIMIT,
    searchLimit = SEARCH_LIMIT,
  }: UseIssuesOptions = {}
): UseIssuesResult {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');

  useEffect(() => {
    const id = setTimeout(() => setDebouncedTerm(searchTerm), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchTerm]);

  const isReady = enabled && !!provider;

  const {
    data: initialIssues,
    isLoading: isLoadingInitial,
    error: initialError,
  } = useQuery({
    queryKey: ['issues:initial', provider, projectPath ?? '', nameWithOwner ?? '', initialLimit],
    queryFn: async () => {
      if (!provider) return [] as Issue[];

      const result = await rpc.issues.listIssues(provider, {
        limit: initialLimit,
        projectPath,
        nameWithOwner,
      });

      if (!result?.success) {
        throw new Error(result?.error ?? 'Failed to load issues.');
      }

      return result.issues ?? [];
    },
    staleTime: 60_000,
    enabled: isReady,
  });

  const minSearchLength = getSearchMinLength(provider);
  const isActiveSearch = debouncedTerm.trim().length >= minSearchLength;

  const { data: searchIssues, isFetching: isSearching } = useQuery({
    queryKey: [
      'issues:search',
      provider,
      projectPath ?? '',
      nameWithOwner ?? '',
      debouncedTerm.trim(),
      searchLimit,
    ],
    queryFn: async () => {
      if (!provider) return [] as Issue[];

      const result = await rpc.issues.searchIssues(provider, {
        limit: searchLimit,
        searchTerm: debouncedTerm.trim(),
        projectPath,
        nameWithOwner,
      });

      if (result?.success) {
        return result.issues ?? [];
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
  }, [initialIssues, isActiveSearch, searchIssues]);

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
