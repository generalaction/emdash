import { CheckIcon, RefreshCw, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { motion } from 'motion/react';
import { useState } from 'react';
import type { UserItem } from '@renderer/features/projects/components/pr-view/pr-filter-items';
import {
  usePrViewState,
  type LabelItem,
  type StatusFilter,
} from '@renderer/features/projects/components/pr-view/usePrViewState';
import { getRepositoryStore } from '@renderer/features/projects/stores/project-selectors';
import { FilterMenuButton } from '@renderer/lib/components/filter-menu-button';
import { SortSelect } from '@renderer/lib/components/sort-select';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import { Button } from '@renderer/lib/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import { Input } from '@renderer/lib/ui/input';
import { SearchInput } from '@renderer/lib/ui/search-input';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import type { PrSortField } from '@shared/core/pull-requests/pull-requests';
import { PrSyncStatusCard } from './pr-sync-status-card';
import { PrVirtualList } from './pr-virtual-list';

const SORT_OPTIONS: { value: PrSortField; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'recently-updated', label: 'Recently Updated' },
];

function UserFilterPopover({
  label,
  items,
  selected,
  onChange,
}: {
  label: string;
  items: UserItem[];
  selected: string | null;
  onChange: (value: string | null) => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = items.filter((i) => i.label.toLowerCase().includes(search.toLowerCase()));

  return (
    <FilterMenuButton label={label} active={selected !== null} disabled={items.length === 0}>
      <Input
        className="mb-1 h-7 text-xs"
        placeholder={`Search ${label.toLowerCase()}…`}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
      />
      <ul className="max-h-52 overflow-y-auto">
        {filtered.map((item) => (
          <li key={item.value}>
            <button
              className="hover:bg-muted flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm"
              onClick={() => onChange(selected === item.value ? null : item.value)}
            >
              {item.avatarUrl ? (
                <img
                  src={item.avatarUrl}
                  alt={item.label}
                  className="size-4 shrink-0 rounded-full"
                />
              ) : (
                <span className="bg-muted-foreground/20 size-4 shrink-0 rounded-full" />
              )}
              <span className="flex-1 truncate text-left">{item.label}</span>
              {selected === item.value && (
                <CheckIcon className="size-3.5 shrink-0 text-foreground" />
              )}
            </button>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="text-muted-foreground px-2 py-3 text-center text-xs">No results</li>
        )}
      </ul>
    </FilterMenuButton>
  );
}

function LabelFilterPopover({
  items,
  selected,
  onChange,
}: {
  items: LabelItem[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = items.filter((i) => i.label.toLowerCase().includes(search.toLowerCase()));

  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);

  return (
    <FilterMenuButton label="Label" active={selected.length > 0} disabled={items.length === 0}>
      <Input
        className="mb-1 h-7 text-xs"
        placeholder="Search labels…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
      />
      <ul className="max-h-52 overflow-y-auto">
        {filtered.map((item) => (
          <li key={item.value}>
            <button
              className="hover:bg-muted flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm"
              onClick={() => toggle(item.value)}
            >
              {item.color ? (
                <span
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: `#${item.color}` }}
                />
              ) : (
                <span className="bg-muted-foreground/20 size-3 shrink-0 rounded-full" />
              )}
              <span className="flex-1 truncate text-left">{item.label}</span>
              {selected.includes(item.value) && (
                <CheckIcon className="size-3.5 shrink-0 text-foreground" />
              )}
            </button>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="text-muted-foreground px-2 py-3 text-center text-xs">No results</li>
        )}
      </ul>
    </FilterMenuButton>
  );
}

function FilterPill({
  avatarUrl,
  color,
  label,
  onRemove,
}: {
  avatarUrl?: string;
  color?: string;
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="bg-muted inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs">
      {avatarUrl && <img src={avatarUrl} alt={label} className="size-3.5 rounded-full" />}
      {color && (
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: `#${color}` }} />
      )}
      {label}
      <button
        className="text-muted-foreground ml-0.5 rounded-full hover:text-foreground"
        onClick={onRemove}
        aria-label={`Remove ${label} filter`}
      >
        <X className="size-2.5" />
      </button>
    </span>
  );
}

export const PullRequestView = observer(function PullRequestView() {
  const {
    params: { projectId },
  } = useParams('project');
  const repositoryStore = getRepositoryStore(projectId);
  const repositoryUrl = repositoryStore?.pullRequestRepositoryUrl ?? null;

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
    error,
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
            <SortSelect
              value={sortFilter}
              options={SORT_OPTIONS}
              onValueChange={handleSortChange}
            />

            <div className="flex items-center gap-3">
              <span className="text-sm text-foreground-passive">Filter by</span>
              <UserFilterPopover
                label="Author"
                items={authorItems}
                selected={selectedAuthorLogin}
                onChange={setSelectedAuthorLogin}
              />
              <LabelFilterPopover
                items={labelItems}
                selected={selectedLabelNames}
                onChange={setSelectedLabelNames}
              />
              <UserFilterPopover
                label="Assignee"
                items={assigneeItems}
                selected={selectedAssigneeLogin}
                onChange={setSelectedAssigneeLogin}
              />
            </div>
          </div>

          {/* ── Active filter pills ── */}
          {hasPills && (
            <div className="flex flex-wrap items-center gap-1.5">
              {selectedAuthorItem && (
                <FilterPill
                  label={selectedAuthorItem.label}
                  avatarUrl={selectedAuthorItem.avatarUrl}
                  onRemove={() => setSelectedAuthorLogin(null)}
                />
              )}
              {selectedLabelItems.map((l) => (
                <FilterPill
                  key={l.value}
                  label={l.label}
                  color={l.color}
                  onRemove={() => removeLabel(l.value)}
                />
              ))}
              {selectedAssigneeItem && (
                <FilterPill
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
        error={error}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        fetchNextPage={fetchNextPage}
      />
      <PrSyncStatusCard
        projectId={projectId}
        repositoryUrl={repositoryUrl}
        manualError={prs.length > 0 ? error : null}
      />
    </div>
  );
});
