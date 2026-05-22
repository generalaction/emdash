import { CheckIcon, ChevronDownIcon, Github, RefreshCw, X } from 'lucide-react';
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
import { useNavigate, useParams } from '@renderer/lib/layout/navigation-provider';
import { useGithubContext } from '@renderer/lib/providers/github-context-provider';
import { Button } from '@renderer/lib/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { Input } from '@renderer/lib/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { SearchInput } from '@renderer/lib/ui/search-input';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import type { PrSortField, ReviewStateFilter } from '@shared/pull-requests';
import { PrSyncStatusCard } from './pr-sync-status-card';
import { PrVirtualList } from './pr-virtual-list';

const SORT_OPTIONS: { value: PrSortField; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'recently-updated', label: 'Recently Updated' },
];

const REVIEW_FILTER_OPTIONS: {
  value: ReviewStateFilter;
  label: string;
  requiresUser?: boolean;
}[] = [
  { value: 'no_reviews', label: 'No reviews' },
  { value: 'review_required', label: 'Review required' },
  { value: 'approved', label: 'Approved review' },
  { value: 'changes_requested', label: 'Changes requested' },
  { value: 'reviewed_by_you', label: 'Reviewed by you', requiresUser: true },
  { value: 'not_reviewed_by_you', label: 'Not reviewed by you', requiresUser: true },
  { value: 'awaiting_review_from_you', label: 'Awaiting review from you', requiresUser: true },
];

function FilterButton({
  label,
  value,
  onClear,
  disabled,
  children,
}: {
  label: string;
  value?: string | null;
  onClear?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const active = value != null && value !== '';

  if (active) {
    return (
      <div className="inline-flex items-stretch rounded-md border border-border bg-background-1 text-xs">
        <Popover>
          <PopoverTrigger className="flex items-center gap-1 px-2 py-1 hover:text-foreground">
            <span className="text-foreground-passive">{label}</span>
            <span className="font-medium text-foreground">{value}</span>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 gap-0 p-2">
            {children}
          </PopoverContent>
        </Popover>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            className="border-l border-border px-1.5 text-foreground-muted hover:text-foreground"
            aria-label={`Clear ${label} filter`}
          >
            <X className="size-3" />
          </button>
        )}
      </div>
    );
  }

  return (
    <Popover>
      <PopoverTrigger
        disabled={disabled}
        className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground-muted transition-colors hover:bg-background-1 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
      >
        {label}
        <ChevronDownIcon className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 gap-0 p-2">
        {children}
      </PopoverContent>
    </Popover>
  );
}

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
  const selectedItem = items.find((i) => i.value === selected) ?? null;

  return (
    <FilterButton
      label={label}
      value={selectedItem?.label}
      onClear={() => onChange(null)}
      disabled={items.length === 0}
    >
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
    </FilterButton>
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

  const selectedItems = items.filter((i) => selected.includes(i.value));
  const value =
    selectedItems.length === 0
      ? null
      : selectedItems.length === 1
        ? selectedItems[0]!.label
        : `${selectedItems.length} labels`;

  return (
    <FilterButton
      label="Label"
      value={value}
      onClear={() => onChange([])}
      disabled={items.length === 0}
    >
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
    </FilterButton>
  );
}

function ReviewsFilterDropdown({
  value,
  onChange,
  hasCurrentUser,
}: {
  value: ReviewStateFilter | null;
  onChange: (next: ReviewStateFilter | null) => void;
  hasCurrentUser: boolean;
}) {
  const activeLabel = value
    ? (REVIEW_FILTER_OPTIONS.find((o) => o.value === value)?.label ?? value)
    : null;

  const dropdown = (
    <DropdownMenuContent align="end" className="min-w-52">
      <DropdownMenuRadioGroup value={value ?? ''}>
        {REVIEW_FILTER_OPTIONS.map((option) => {
          const disabled = option.requiresUser && !hasCurrentUser;
          return (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              disabled={disabled}
              onClick={() => onChange(value === option.value ? null : option.value)}
            >
              {option.label}
            </DropdownMenuRadioItem>
          );
        })}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  );

  if (activeLabel) {
    return (
      <div className="inline-flex items-stretch rounded-md border border-border bg-background-1 text-xs">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-1 px-2 py-1 hover:text-foreground">
            <span className="text-foreground-passive">Reviews</span>
            <span className="font-medium text-foreground">{activeLabel}</span>
          </DropdownMenuTrigger>
          {dropdown}
        </DropdownMenu>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="border-l border-border px-1.5 text-foreground-muted hover:text-foreground"
          aria-label="Clear Reviews filter"
        >
          <X className="size-3" />
        </button>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground-muted transition-colors hover:bg-background-1 hover:text-foreground">
        Reviews
        <ChevronDownIcon className="size-3.5" />
      </DropdownMenuTrigger>
      {dropdown}
    </DropdownMenu>
  );
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
    reviewStateFilter,
    setReviewStateFilter,
    hasCurrentUser,
    handleStatusChange,
    handleSortChange,
    handleRefresh,
    handleForceFullSync,
    prs,
    loading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    authorItems,
    assigneeItems,
    labelItems,
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
              className="w-80"
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
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-stretch rounded-md border border-border bg-background-1 text-xs">
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-1 px-2 py-1 hover:text-foreground">
                <span className="text-foreground-passive">Sort</span>
                <span className="font-medium text-foreground">
                  {(SORT_OPTIONS.find((o) => o.value === sortFilter) ?? SORT_OPTIONS[0]).label}
                </span>
                <ChevronDownIcon className="size-3.5 text-foreground-muted" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-44">
                <DropdownMenuRadioGroup value={sortFilter}>
                  {SORT_OPTIONS.map(({ value, label }) => (
                    <DropdownMenuRadioItem
                      key={value}
                      value={value}
                      onClick={() => handleSortChange(value)}
                    >
                      {label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="mx-1 h-4 w-px bg-border" aria-hidden />

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
          <ReviewsFilterDropdown
            value={reviewStateFilter}
            onChange={setReviewStateFilter}
            hasCurrentUser={hasCurrentUser}
          />
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
