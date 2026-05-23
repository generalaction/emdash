import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { getPrSyncStore } from '@renderer/features/projects/stores/project-selectors';
import { useDebounce } from '@renderer/lib/hooks/useDebounce';
import { rpc } from '@renderer/lib/ipc';
import { useGithubContext } from '@renderer/lib/providers/github-context-provider';
import type { PrFilters, PrSortField, ReviewStateFilter } from '@shared/pull-requests';
import { toUserItem, usersWithLoginFirst, type UserItem } from './pr-filter-items';
import { useFilterOptions, usePullRequests } from './usePullRequests';

const VIEWER_TEAMS_QUERY_KEY = ['github:viewer-teams'] as const;

export type StatusFilter = 'open' | 'not-open';

export type LabelItem = { value: string; label: string; color?: string };

export function usePrViewState(projectId: string, repositoryUrl: string | null) {
  const queryClient = useQueryClient();
  const { user, authenticated } = useGithubContext();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [sortFilter, setSortFilter] = useState<PrSortField>('newest');
  const [selectedAuthorUserId, setSelectedAuthorUserId] = useState<string | null>(null);
  const [selectedLabelNames, setSelectedLabelNames] = useState<string[]>([]);
  const [selectedAssigneeUserId, setSelectedAssigneeUserId] = useState<string | null>(null);
  const [reviewStateFilter, setReviewStateFilter] = useState<ReviewStateFilter | null>(null);
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 200);
  const [syncing, setSyncing] = useState(false);

  const currentUserId = user?.id != null ? String(user.id) : undefined;

  const { data: viewerTeams = [] } = useQuery({
    queryKey: VIEWER_TEAMS_QUERY_KEY,
    queryFn: () => rpc.github.getViewerTeams(),
    enabled: authenticated,
    staleTime: 5 * 60_000,
  });

  const currentUserTeamIds = useMemo(
    () => (viewerTeams.length > 0 ? viewerTeams.map((team) => team.teamId) : undefined),
    [viewerTeams]
  );

  const filters: PrFilters = {
    status: statusFilter,
    ...(selectedAuthorUserId ? { authorUserIds: [selectedAuthorUserId] } : {}),
    ...(selectedLabelNames.length > 0 ? { labelNames: selectedLabelNames } : {}),
    ...(selectedAssigneeUserId ? { assigneeUserIds: [selectedAssigneeUserId] } : {}),
    ...(reviewStateFilter ? { reviewState: reviewStateFilter } : {}),
    ...(currentUserId ? { currentUserId } : {}),
    ...(currentUserTeamIds ? { currentUserTeamIds } : {}),
  };

  const { prs, refresh, loading, dataUpdatedAt, fetchNextPage, hasNextPage, isFetchingNextPage } =
    usePullRequests(projectId, repositoryUrl ?? undefined, {
      filters,
      sort: sortFilter,
      searchQuery: debouncedQuery || undefined,
    });

  useEffect(() => {
    if (dataUpdatedAt > 0 && repositoryUrl) {
      void queryClient.invalidateQueries({ queryKey: ['pr-filter-options', repositoryUrl] });
    }
  }, [dataUpdatedAt, repositoryUrl, queryClient]);

  const { data: filterOptions } = useFilterOptions(
    projectId,
    repositoryUrl ?? undefined,
    statusFilter
  );

  const authorItems: UserItem[] = useMemo(
    () =>
      usersWithLoginFirst(filterOptions?.authors ?? [], user?.login).map((author) =>
        toUserItem(author)
      ),
    [filterOptions?.authors, user?.login]
  );

  const assigneeItems: UserItem[] = useMemo(
    () => (filterOptions?.assignees ?? []).map((assignee) => toUserItem(assignee)),
    [filterOptions?.assignees]
  );

  const labelItems: LabelItem[] = useMemo(
    () =>
      (filterOptions?.labels ?? []).map((l) => ({
        value: l.name,
        label: l.name,
        color: l.color ?? undefined,
      })),
    [filterOptions?.labels]
  );

  const selectedAuthorItem = authorItems.find((a) => a.value === selectedAuthorUserId);
  const selectedAssigneeItem = assigneeItems.find((a) => a.value === selectedAssigneeUserId);
  const selectedLabelItems = useMemo(
    () => labelItems.filter((l) => selectedLabelNames.includes(l.value)),
    [labelItems, selectedLabelNames]
  );

  const hasPills = Boolean(
    selectedAuthorUserId ||
    selectedAssigneeUserId ||
    selectedLabelNames.length > 0 ||
    reviewStateFilter
  );

  const handleStatusChange = (value: StatusFilter) => {
    setStatusFilter(value);
    setSelectedAuthorUserId(null);
    setSelectedLabelNames([]);
    setSelectedAssigneeUserId(null);
  };

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

  const handleForceFullSync = async () => {
    setSyncing(true);
    try {
      await rpc.pullRequests.forceFullSyncPullRequests(projectId);
      await queryClient.invalidateQueries({ queryKey: ['pull-requests', projectId] });
    } finally {
      setSyncing(false);
    }
  };

  const prSyncStore = getPrSyncStore(projectId);
  const backgroundSyncing = repositoryUrl
    ? (prSyncStore?.isSyncing(repositoryUrl) ?? false)
    : false;
  const isSyncing = syncing || backgroundSyncing;

  const removeLabel = (name: string) =>
    setSelectedLabelNames((prev) => prev.filter((n) => n !== name));

  return {
    // filter state
    statusFilter,
    sortFilter,
    query,
    setQuery,
    syncing: isSyncing,
    selectedAuthorLogin: selectedAuthorUserId,
    setSelectedAuthorLogin: setSelectedAuthorUserId,
    selectedLabelNames,
    setSelectedLabelNames,
    selectedAssigneeLogin: selectedAssigneeUserId,
    setSelectedAssigneeLogin: setSelectedAssigneeUserId,
    reviewStateFilter,
    setReviewStateFilter,
    hasCurrentUser: currentUserId != null,
    // handlers
    handleStatusChange,
    handleSortChange,
    handleRefresh,
    handleForceFullSync,
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
