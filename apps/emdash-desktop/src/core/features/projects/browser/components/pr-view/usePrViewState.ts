import { WireError } from '@emdash/wire/rpc';
import { useEffect, useMemo, useState } from 'react';
import { useProjectAccount } from '@core/features/integrations/api/browser/use-project-account';
import { pullRequestErrorMessage } from '@root/src/core/services/pull-requests/api';
import type { PullRequestFilters } from '@root/src/core/services/pull-requests/api';
import { usePullRequestsStore } from '@root/src/core/services/pull-requests/browser';
import { toUserItem, usersWithLoginFirst, type UserItem } from './pr-filter-items';

export type StatusFilter = 'open' | 'not-open';

export type LabelItem = { value: string; label: string; color?: string };

export function usePrViewState(projectId: string, repositoryUrl: string) {
  const store = usePullRequestsStore();
  const listView = store.listView.store;
  const account = useProjectAccount(projectId, 'github', {
    repository: { kind: 'project' },
  })?.value;
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [selectedAuthorUserId, setSelectedAuthorUserId] = useState<string | null>(null);
  const [selectedLabelNames, setSelectedLabelNames] = useState<string[]>([]);
  const [selectedAssigneeUserId, setSelectedAssigneeUserId] = useState<string | null>(null);
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

  const authorItems: UserItem[] = useMemo(
    () =>
      usersWithLoginFirst(store.filterOptions.authors, account?.login).map((author) =>
        toUserItem(author)
      ),
    [store.filterOptions.authors, account?.login]
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

  function captureRefreshError(error: unknown): void {
    setRefreshError(error instanceof Error ? error.message : String(error));
  }

  const handleRefresh = async () => {
    setSyncing(true);
    setRefreshError(null);
    try {
      const result = await store.refreshRepository(repositoryUrl);
      if (!result.success) captureRefreshError(pullRequestErrorMessage(result.error));
    } catch (error) {
      captureRefreshError(error);
    } finally {
      setSyncing(false);
    }
  };

  const handleRefreshHistory = async () => {
    setSyncing(true);
    setRefreshError(null);
    try {
      const result = await store.refreshHistory(repositoryUrl);
      if (!result.success) {
        captureRefreshError(pullRequestErrorMessage(result.error));
      }
    } catch (error) {
      if (!(error instanceof WireError && error.code === 'CANCELLED')) captureRefreshError(error);
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
    syncing: isSyncing,
    selectedAuthorLogin: selectedAuthorUserId,
    setSelectedAuthorLogin: setSelectedAuthorUserId,
    selectedLabelNames,
    setSelectedLabelNames,
    selectedAssigneeLogin: selectedAssigneeUserId,
    setSelectedAssigneeLogin: setSelectedAssigneeUserId,
    // handlers
    handleStatusChange,
    handleRefresh,
    handleRefreshHistory,
    removeLabel,
    // data
    prs: listView.visibleItems,
    error: refreshError ?? listError ?? syncError,
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
