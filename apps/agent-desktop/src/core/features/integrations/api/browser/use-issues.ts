import { useQuery } from '@tanstack/react-query';
import { useObserver } from 'mobx-react-lite';
import { useEffect, useMemo, useState } from 'react';
import { getIssuesClient } from '@core/features/issues/api/browser/client';
import { getProjectSettingsStore } from '@core/features/projects/api/browser/stores/project-selectors';
import type {
  IssueAccountUnavailableError,
  IssueProviderType,
} from '@core/primitives/issue-providers/api';
import type { LinkedIssue } from '@core/primitives/linked-issues/api';
import { providerAccountContextKey } from '@core/primitives/project-settings/api';
import { useAccounts } from './use-provider-accounts';

const INITIAL_FETCH_LIMIT = 50;
const SEARCH_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_MIN_LENGTH = 2;

export interface UseIssuesResult {
  issues: LinkedIssue[];
  isLoading: boolean;
  error: string | null;
  /**
   * The project's account resolution produced no usable account.
   * Carried separately from `error` so
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
  const accountInventory = useAccounts();
  const projectAccountContext = useObserver(() => {
    if (!projectId) return { ready: true, choice: undefined, error: null };
    const settings = getProjectSettingsStore(projectId);
    const accounts = settings?.durableDomains?.integrationAccounts;
    return {
      ready: accounts !== undefined,
      choice: provider ? accounts?.stored[provider] : undefined,
      error: settings?.pageData.error ?? null,
    };
  });
  const accountKey = providerAccountContextKey(
    projectAccountContext.choice,
    (provider ? accountInventory.data?.[provider] : undefined) ?? []
  );
  const searchContextKey = JSON.stringify([
    provider,
    projectId ?? '',
    projectPath ?? '',
    repositoryUrl ?? '',
    searchLimit,
    accountKey,
  ]);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedTerm(searchTerm), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchTerm]);

  const isReady =
    enabled &&
    !!provider &&
    accountInventory.data !== undefined &&
    !accountInventory.isError &&
    projectAccountContext.ready;

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
      accountKey,
    ],
    queryFn: async () => {
      if (!provider) return { success: true as const, data: [] as LinkedIssue[] };

      const result = await (
        await getIssuesClient()
      ).listIssues({
        provider,
        options: {
          limit: initialLimit,
          projectId,
          projectPath,
          repositoryUrl,
          accountContext: accountKey,
        },
      });

      if (!result.success && result.error.type === 'account_context_changed') {
        void accountInventory.refetch();
        if (projectId) getProjectSettingsStore(projectId)?.pageData.invalidate();
        throw new Error(result.error.message);
      }
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
      searchContextKey,
    ],
    queryFn: async () => {
      if (!provider) return { success: true as const, data: [] as LinkedIssue[] };

      const result = await (
        await getIssuesClient()
      ).searchIssues({
        provider,
        options: {
          accountContext: accountKey,
          limit: searchLimit,
          searchTerm: debouncedTerm.trim(),
          projectId,
          projectPath,
          repositoryUrl,
        },
      });

      if (!result.success && result.error.type === 'account_context_changed') {
        void accountInventory.refetch();
        if (projectId) getProjectSettingsStore(projectId)?.pageData.invalidate();
        throw new Error(result.error.message);
      }
      return result;
    },
    staleTime: 30_000,
    enabled: isReady && isActiveSearch,
    // Only the search term may vary when reusing the preceding result page.
    // Provider, project, repository and account must all remain identical.
    placeholderData: (previous, query) =>
      query?.queryKey.at(-1) === searchContextKey ? previous : undefined,
  });

  const issues = useMemo<LinkedIssue[]>(() => {
    if (!isReady) return [];
    if (isActiveSearch) return searchIssues?.success ? (searchIssues.data ?? []) : [];
    return initialIssues?.success ? (initialIssues.data ?? []) : [];
  }, [initialIssues, isActiveSearch, searchIssues, isReady]);

  const activeResult = isReady ? (isActiveSearch ? searchIssues : initialIssues) : undefined;
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
        : (accountInventory.error?.message ?? projectAccountContext.error);

  return {
    issues,
    isLoading:
      enabled &&
      !!provider &&
      (isLoadingInitial ||
        accountInventory.isPending ||
        (!projectAccountContext.ready && !projectAccountContext.error)),
    error,
    accountUnavailable,
    searchTerm,
    setSearchTerm,
    isSearching: isReady && isActiveSearch && isSearching,
  };
}
