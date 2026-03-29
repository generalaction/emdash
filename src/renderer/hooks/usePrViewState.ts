import { useEffect, useMemo, useState } from 'react';
import type { PrFilters, PrSortField } from '@shared/pull-requests';
import { useFilterOptions, usePullRequests } from './usePullRequests';

export type StatusFilter = 'open' | 'not-open';

export type UserItem = { value: string; label: string; avatarUrl?: string };
export type LabelItem = { value: string; label: string; color?: string };

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export function usePrViewState(projectId: string, nameWithOwner: string | null) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [sortFilter, setSortFilter] = useState<PrSortField>('newest');
  const [selectedAuthorLogin, setSelectedAuthorLogin] = useState<string | null>(null);
  const [selectedLabelNames, setSelectedLabelNames] = useState<string[]>([]);
  const [selectedAssigneeLogin, setSelectedAssigneeLogin] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 200);
  const [syncing, setSyncing] = useState(false);

  const filters: PrFilters = {
    status: statusFilter,
    ...(selectedAuthorLogin ? { authorLogins: [selectedAuthorLogin] } : {}),
    ...(selectedLabelNames.length > 0 ? { labelNames: selectedLabelNames } : {}),
    ...(selectedAssigneeLogin ? { assigneeLogins: [selectedAssigneeLogin] } : {}),
  };

  const { prs, refresh, loading, fetchNextPage, hasNextPage, isFetchingNextPage } = usePullRequests(
    projectId,
    nameWithOwner ?? undefined,
    {
      filters,
      sort: sortFilter,
      searchQuery: debouncedQuery || undefined,
    }
  );

  const { data: filterOptions } = useFilterOptions(projectId, nameWithOwner ?? undefined);

  const authorItems: UserItem[] = useMemo(
    () =>
      (filterOptions?.authors ?? []).map((a) => ({
        value: a.userName,
        label: a.displayName,
        avatarUrl: a.avatarUrl,
      })),
    [filterOptions?.authors]
  );

  const assigneeItems: UserItem[] = useMemo(
    () =>
      (filterOptions?.assignees ?? []).map((a) => ({
        value: a.userName,
        label: a.displayName ?? a.userName,
        avatarUrl: a.avatarUrl,
      })),
    [filterOptions?.assignees]
  );

  const labelItems: LabelItem[] = useMemo(
    () =>
      (filterOptions?.labels ?? []).map((l) => ({
        value: l.name,
        label: l.name,
        color: l.color,
      })),
    [filterOptions?.labels]
  );

  const selectedAuthorItem = authorItems.find((a) => a.value === selectedAuthorLogin);
  const selectedAssigneeItem = assigneeItems.find((a) => a.value === selectedAssigneeLogin);
  const selectedLabelItems = useMemo(
    () => labelItems.filter((l) => selectedLabelNames.includes(l.value)),
    [labelItems, selectedLabelNames]
  );

  const hasPills = Boolean(
    selectedAuthorLogin || selectedAssigneeLogin || selectedLabelNames.length > 0
  );

  const handleStatusChange = (value: StatusFilter) => setStatusFilter(value);

  const handleSortChange = (value: string | null) => {
    if (value) setSortFilter(value as PrSortField);
  };

  const handleRefresh = async () => {
    setSyncing(true);
    try {
      await refresh();
    } finally {
      setSyncing(false);
    }
  };

  const removeLabel = (name: string) =>
    setSelectedLabelNames((prev) => prev.filter((n) => n !== name));

  return {
    // filter state
    statusFilter,
    sortFilter,
    query,
    setQuery,
    syncing,
    selectedAuthorLogin,
    setSelectedAuthorLogin,
    selectedLabelNames,
    setSelectedLabelNames,
    selectedAssigneeLogin,
    setSelectedAssigneeLogin,
    // handlers
    handleStatusChange,
    handleSortChange,
    handleRefresh,
    removeLabel,
    // data
    prs,
    loading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    // filter option items
    authorItems,
    assigneeItems,
    labelItems,
    // active pills
    selectedAuthorItem,
    selectedAssigneeItem,
    selectedLabelItems,
    hasPills,
  };
}
