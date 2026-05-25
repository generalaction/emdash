import { Github, RefreshCw } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { motion } from 'motion/react';
import {
  usePrViewState,
  type LabelItem,
  type StatusFilter,
  type UserItem,
} from '@renderer/features/projects/components/pr-view/usePrViewState';
import { getRepositoryStore } from '@renderer/features/projects/stores/project-selectors';
import { ListFilterMultiSelect } from '@renderer/lib/components/list-filters/list-filter-multi-select';
import { ListFilterPill } from '@renderer/lib/components/list-filters/list-filter-pill';
import { ListFilterSearchableSelect } from '@renderer/lib/components/list-filters/list-filter-searchable-select';
import { useNavigate, useParams } from '@renderer/lib/layout/navigation-provider';
import { useGithubContext } from '@renderer/lib/providers/github-context-provider';
import { Button } from '@renderer/lib/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import { SearchInput } from '@renderer/lib/ui/search-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import type { PrSortField } from '@shared/pull-requests';
import { PrSyncStatusCard } from './pr-sync-status-card';
import { PrVirtualList } from './pr-virtual-list';

const SORT_OPTIONS: { value: PrSortField; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'recently-updated', label: 'Recently Updated' },
];

function userFilterLeading(item: UserItem) {
  if (item.avatarUrl) {
    return <img src={item.avatarUrl} alt={item.label} className="size-4 shrink-0 rounded-full" />;
  }
  return <span className="bg-muted-foreground/20 size-4 shrink-0 rounded-full" />;
}

function labelFilterLeading(item: LabelItem) {
  if (item.color) {
    return (
      <span
        className="size-3 shrink-0 rounded-full"
        style={{ backgroundColor: `#${item.color}` }}
      />
    );
  }
  return <span className="bg-muted-foreground/20 size-3 shrink-0 rounded-full" />;
}

export const PullRequestView = observer(function PullRequestView() {
  const {
    params: { projectId },
  } = useParams('project');
  const repositoryUrl = getRepositoryStore(projectId)?.repositoryUrl ?? null;
  const { needsGhAuth } = useGithubContext();
  const { navigate } = useNavigate();

  const {
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
    handleStatusChange,
    handleSortChange,
    handleRefresh,
    handleForceFullSync,
    removeLabel,
    prs,
    loading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    authorItems,
    assigneeItems,
    labelItems,
    selectedAuthorItem,
    selectedAssigneeItem,
    selectedLabelItems,
    hasPills,
  } = usePrViewState(projectId, repositoryUrl);

  if (!repositoryUrl) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col">
        <p className="text-muted-foreground py-4 text-center text-sm">
          Pull requests are currently available only for configured GitHub remotes. You can change
          the remote in the project settings.
        </p>
      </div>
    );
  }

  if (needsGhAuth) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col">
        <div className="mt-4 flex w-full flex-col items-center justify-center gap-5 rounded-md border border-dashed border-border p-8">
          <span className="relative flex size-8 items-center justify-center overflow-hidden rounded-full bg-background-2">
            <Github className="size-4 text-foreground-muted" />
          </span>
          <p className="text-center text-sm font-normal text-foreground-muted">
            GitHub is not connected. Create a user account and connect your GitHub account to view
            pull requests.
          </p>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() =>
              navigate('settings', {
                tab: 'account',
              })
            }
          >
            Connect User Account
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col">
      {/* ── Header controls ── */}
      <div className="flex flex-col gap-4 border-b border-border pb-2">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
          <ToggleGroup
            value={[statusFilter]}
            onValueChange={(values) => {
              const next = values.find((v) => v !== statusFilter) ?? statusFilter;
              handleStatusChange(next as StatusFilter);
            }}
          >
            <ToggleGroupItem value="open">Open</ToggleGroupItem>
            <ToggleGroupItem value="not-open">Closed</ToggleGroupItem>
          </ToggleGroup>

          <div className="flex items-center gap-2">
            <SearchInput
              placeholder="Search by title, branch, or number..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <ContextMenu>
              <ContextMenuTrigger>
                <Button variant="outline" size="icon-md" onClick={handleRefresh} disabled={syncing}>
                  <motion.div
                    animate={syncing ? { rotate: 360 } : {}}
                    transition={syncing ? { repeat: Infinity, duration: 0.8, ease: 'linear' } : {}}
                  >
                    <RefreshCw className="size-3.5" />
                  </motion.div>
                </Button>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onClick={handleForceFullSync} disabled={syncing}>
                  <RefreshCw className="size-4" />
                  Force full sync
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </div>
        </div>

        {/* ── Sort + filter row ── */}
        <div className="flex flex-col flex-wrap gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-foreground-passive">Sort</span>
              <Select value={sortFilter} onValueChange={handleSortChange}>
                <SelectTrigger
                  size="sm"
                  className="w-auto gap-1 border-none p-0 text-foreground-muted hover:text-foreground"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map(({ value, label }) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-sm text-foreground-passive">Filter by</span>
              <ListFilterSearchableSelect
                label="Author"
                items={authorItems}
                selected={selectedAuthorLogin}
                onChange={setSelectedAuthorLogin}
                renderLeading={userFilterLeading}
              />
              <ListFilterMultiSelect
                label="Label"
                items={labelItems}
                selected={selectedLabelNames}
                onChange={setSelectedLabelNames}
                renderLeading={labelFilterLeading}
                searchPlaceholder="Search labels…"
              />
              <ListFilterSearchableSelect
                label="Assignee"
                items={assigneeItems}
                selected={selectedAssigneeLogin}
                onChange={setSelectedAssigneeLogin}
                renderLeading={userFilterLeading}
              />
            </div>
          </div>

          {/* ── Active filter pills ── */}
          {hasPills && (
            <div className="flex flex-wrap items-center gap-1.5">
              {selectedAuthorItem && (
                <ListFilterPill
                  label={selectedAuthorItem.label}
                  avatarUrl={selectedAuthorItem.avatarUrl}
                  onRemove={() => setSelectedAuthorLogin(null)}
                />
              )}
              {selectedLabelItems.map((l) => (
                <ListFilterPill
                  key={l.value}
                  label={l.label}
                  color={l.color}
                  onRemove={() => removeLabel(l.value)}
                />
              ))}
              {selectedAssigneeItem && (
                <ListFilterPill
                  label={selectedAssigneeItem.label}
                  avatarUrl={selectedAssigneeItem.avatarUrl}
                  onRemove={() => setSelectedAssigneeLogin(null)}
                />
              )}
            </div>
          )}
        </div>
      </div>
      <PrVirtualList
        prs={prs}
        projectId={projectId}
        loading={loading}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        fetchNextPage={fetchNextPage}
      />
      <PrSyncStatusCard projectId={projectId} repositoryUrl={repositoryUrl} />
    </div>
  );
});
