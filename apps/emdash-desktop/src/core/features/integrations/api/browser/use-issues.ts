import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { getIssuesClient } from '@core/features/issues/api/browser/client';
import type {
  IssueAccountUnavailableError,
  IssueProviderType,
} from '@core/primitives/issue-providers/api';
import type { LinkedIssue } from '@core/primitives/linked-issues/api';

const INITIAL_FETCH_LIMIT = 50;
const SEARCH_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_MIN_LENGTH = 2;

export interface UseIssuesResult {
  issues: LinkedIssue[];
  isLoading: boolean;
  error: string | null;
  /**
   * The project's GitHub account resolution produced no usable account
   * (spec: github-git-settings §7). Carried separately from `error` so
   * surfaces render the reporting matrix (quiet disabled/connect states,
   * fail-closed unresolvable pin) instead of a generic error message.
   */
  accountUnavailable: IssueAccountUnavailableError | null;
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
      if (!provider) return { success: true as const, data: [] as LinkedIssue[] };

      const result = await (
        await getIssuesClient()
      ).listIssues({
        provider,
        options: { limit: initialLimit, projectId, projectPath, repositoryUrl },
      });

      return result;
    },
    staleTime: 60_000,
    enabled: isReady,
  });

  const isActiveSearch = debouncedTerm.trim().length >= SEARCH_MIN_LENGTH;

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
      if (!provider) return { success: true as const, data: [] as LinkedIssue[] };

      const result = await (
        await getIssuesClient()
      ).searchIssues({
        provider,
        options: {
          limit: searchLimit,
          searchTerm: debouncedTerm.trim(),
          projectId,
          projectPath,
          repositoryUrl,
        },
      });

      return result;
    },
    staleTime: 30_000,
    enabled: isReady && isActiveSearch,
    placeholderData: keepPreviousData,
  });

  const issues = useMemo<LinkedIssue[]>(() => {
    if (isActiveSearch) return searchIssues?.success ? (searchIssues.data ?? []) : [];
    return initialIssues?.success ? (initialIssues.data ?? []) : [];
  }, [initialIssues, isActiveSearch, searchIssues]);

  const activeResult = isActiveSearch ? searchIssues : initialIssues;
  const activeQueryError = isActiveSearch ? searchError : initialError;
  const accountUnavailable =
    activeResult && !activeResult.success && activeResult.error.type === 'account_unavailable'
      ? activeResult.error
      : null;
  const error =
    activeResult && !activeResult.success && !accountUnavailable
      ? activeResult.error.message
      : activeQueryError instanceof Error
        ? activeQueryError.message
        : null;

  return {
    issues,
    isLoading: isLoadingInitial,
    error,
    accountUnavailable,
    searchTerm,
    setSearchTerm,
    isSearching: isActiveSearch && isSearching,
  };
}
