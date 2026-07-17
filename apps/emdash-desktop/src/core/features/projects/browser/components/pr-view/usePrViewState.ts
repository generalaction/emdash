import { useEffect, useMemo, useState } from 'react';
import { useGithubContext } from '@renderer/lib/providers/github-context-provider';
import { pullRequestErrorMessage } from '@root/src/core/services/pull-requests/api';
import type {
  PullRequestFilters,
  PullRequestSort,
} from '@root/src/core/services/pull-requests/api';
import { usePullRequestsStore } from '@root/src/core/services/pull-requests/browser';
import { toUserItem, usersWithLoginFirst, type UserItem } from './pr-filter-items';

export type StatusFilter = 'open' | 'not-open';

export type LabelItem = { value: string; label: string; color?: string };

export function usePrViewState(repositoryUrl: string) {
  const store = usePullRequestsStore();
  const listView = store.listView.store;
  const { user } = useGithubContext();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [sortFilter, setSortFilter] = useState<PullRequestSort>('newest');
  const [selectedAuthorUserId, setSelectedAuthorUserId] = useState<string | null>(null);
  const [selectedLabelNames, setSelectedLabelNames] = useState<string[]>([]);
  const [selectedAssigneeUserId, setSelectedAssigneeUserId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  useEffect(() => {
    const filters: PullRequestFilters = {
      status: statusFilter,
      ...(selectedAuthorUserId ? { authorUserIds: [selectedAuthorUserId] } : {}),
      ...(selectedLabelNames.length > 0 ? { labelNames: selectedLabelNames } : {}),
      ...(selectedAssigneeUserId ? { assigneeUserIds: [selectedAssigneeUserId] } : {}),
    };
    listView.filter?.set(filters);
  }, [listView, selectedAssigneeUserId, selectedAuthorUserId, selectedLabelNames, statusFilter]);

  useEffect(() => {
    listView.sort?.setKey(sortFilter);
  }, [listView, sortFilter]);

  const authorItems: UserItem[] = useMemo(
    () =>
      usersWithLoginFirst(store.filterOptions.authors, user?.login).map((author) =>
        toUserItem(author)
      ),
    [store.filterOptions.authors, user?.login]
  );

  const assigneeItems: UserItem[] = useMemo(
    () => store.filterOptions.assignees.map((assignee) => toUserItem(assignee)),
    [store.filterOptions.assignees]
  );

  const labelItems: LabelItem[] = useMemo(
    () =>
      store.filterOptions.labels.map((l) => ({
        value: l.name,
        label: l.name,
        color: l.color ?? undefined,
      })),
    [store.filterOptions.labels]
  );

  const selectedAuthorItem = authorItems.find((a) => a.value === selectedAuthorUserId);
  const selectedAssigneeItem = assigneeItems.find((a) => a.value === selectedAssigneeUserId);
  const selectedLabelItems = useMemo(
    () => labelItems.filter((l) => selectedLabelNames.includes(l.value)),
    [labelItems, selectedLabelNames]
  );

  const hasPills = Boolean(
    selectedAuthorUserId || selectedAssigneeUserId || selectedLabelNames.length > 0
  );

  const handleStatusChange = (value: StatusFilter) => {
    setStatusFilter(value);
  };

  const handleSortChange = (value: string | null) => {
    if (value) setSortFilter(value as PullRequestSort);
  };

  function captureRefreshError(error: unknown): void {
    setRefreshError(error instanceof Error ? error.message : String(error));
  }

  const handleRefresh = async () => {
    setSyncing(true);
    setRefreshError(null);
    try {
      const result = await store.sync(repositoryUrl);
      if (!result.success) captureRefreshError(pullRequestErrorMessage(result.error));
    } catch (error) {
      captureRefreshError(error);
    } finally {
      setSyncing(false);
    }
  };

  const handleForceFullSync = async () => {
    setSyncing(true);
    setRefreshError(null);
    try {
      const result = await store.sync(repositoryUrl, true);
      if (!result.success) {
        captureRefreshError(pullRequestErrorMessage(result.error));
      }
    } catch (error) {
      captureRefreshError(error);
    } finally {
      setSyncing(false);
    }
  };

  const syncState = store.syncState(repositoryUrl);
  const syncError =
    syncState?.phase === 'error' && syncState.error
      ? pullRequestErrorMessage(syncState.error)
      : null;
  const listError =
    listView.status === 'error'
      ? listView.error instanceof Error
        ? listView.error.message
        : String(listView.error)
      : null;
  const isSyncing = syncing || syncState?.phase === 'running';

  const removeLabel = (name: string) =>
    setSelectedLabelNames((prev) => prev.filter((n) => n !== name));

  return {
    // filter state
    statusFilter,
    sortFilter,
    query,
    setQuery: (value: string) => {
      setQuery(value);
      listView.search?.setQuery(value);
    },
    syncing: isSyncing,
    selectedAuthorLogin: selectedAuthorUserId,
    setSelectedAuthorLogin: setSelectedAuthorUserId,
    selectedLabelNames,
    setSelectedLabelNames,
    selectedAssigneeLogin: selectedAssigneeUserId,
    setSelectedAssigneeLogin: setSelectedAssigneeUserId,
    // handlers
    handleStatusChange,
    handleSortChange,
    handleRefresh,
    handleForceFullSync,
    removeLabel,
    // data
    prs: listView.visibleItems,
    loading: listView.status === 'loading',
    error: refreshError ?? listError ?? syncError,
    fetchNextPage: async () => {
      await listView.pagination?.loadMore();
    },
    hasNextPage: listView.pagination?.hasMore ?? false,
    isFetchingNextPage: listView.pagination?.isFetchingMore ?? false,
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
