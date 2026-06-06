import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { rpc } from '@renderer/lib/ipc';
import type { IssueProviderType } from '@shared/issue-providers';
import type { LinkedIssue } from '@shared/linked-issue';

const INITIAL_FETCH_LIMIT = 50;
const SEARCH_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 300;

const SEARCH_MIN_LENGTH_BY_PROVIDER: Partial<Record<IssueProviderType, number>> = {
  plain: 2,
};

export interface UseIssuesResult {
  issues: LinkedIssue[];
  isLoading: boolean;
  error: string | null;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  isSearching: boolean;
}

interface UseIssuesOptions {
  projectId?: string;
  projectPath?: string;
  repositoryUrl?: string;
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
    projectId,
    projectPath,
    repositoryUrl,
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
    queryKey: [
      'issues:initial',
      provider,
      projectId ?? '',
      projectPath ?? '',
      repositoryUrl ?? '',
      initialLimit,
    ],
    queryFn: async () => {
      if (!provider) return { success: true as const, issues: [] as LinkedIssue[] };

      const result = await rpc.issues.listIssues(provider, {
        limit: initialLimit,
        projectId,
        projectPath,
        repositoryUrl,
      });

      return result;
    },
    staleTime: 60_000,
    enabled: isReady,
  });

  const minSearchLength = getSearchMinLength(provider);
  const isActiveSearch = debouncedTerm.trim().length >= minSearchLength;

  const {
    data: searchIssues,
    isFetching: isSearching,
    error: searchError,
  } = useQuery({
    queryKey: [
      'issues:search',
      provider,
      projectId ?? '',
      projectPath ?? '',
      repositoryUrl ?? '',
      debouncedTerm.trim(),
      searchLimit,
    ],
    queryFn: async () => {
      if (!provider) return { success: true as const, issues: [] as LinkedIssue[] };

      const result = await rpc.issues.searchIssues(provider, {
        limit: searchLimit,
        searchTerm: debouncedTerm.trim(),
        projectId,
        projectPath,
        repositoryUrl,
      });

      return result;
    },
    staleTime: 30_000,
    enabled: isReady && isActiveSearch,
    placeholderData: keepPreviousData,
  });

  const issues = useMemo<LinkedIssue[]>(() => {
    if (isActiveSearch) return searchIssues?.success ? (searchIssues.issues ?? []) : [];
    return initialIssues?.success ? (initialIssues.issues ?? []) : [];
  }, [initialIssues, isActiveSearch, searchIssues]);

  const activeResult = isActiveSearch ? searchIssues : initialIssues;
  const activeQueryError = isActiveSearch ? searchError : initialError;
  const error =
    activeResult && !activeResult.success
      ? activeResult.error
      : activeQueryError instanceof Error
        ? activeQueryError.message
        : null;

  return {
    issues,
    isLoading: isLoadingInitial,
    error,
    searchTerm,
    setSearchTerm,
    isSearching: isActiveSearch && isSearching,
  };
}
