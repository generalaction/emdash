import { RefreshCw, Search, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { motion } from 'motion/react';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { PrFilters, PrSortField, PullRequest } from '@shared/pull-requests';
import { Button } from '@renderer/components/ui/button';
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  useComboboxAnchor,
} from '@renderer/components/ui/combobox';
import { Input } from '@renderer/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select';
import { getProjectStore, mountedProjectData } from '@renderer/core/stores/project-selectors';
import { useParams } from '@renderer/core/view/navigation-provider';
import { useFilterOptions, usePullRequests } from '@renderer/hooks/usePullRequests';
import { parseGithubNameWithOwner } from '@renderer/views/tasks/diff-viewer/utils';
import { SearchInput } from '../ui/search-input';
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group';
import { PrRow } from './pr-row';

type StatusFilter = 'open' | 'not-open';

const SORT_OPTIONS: { value: PrSortField; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'recently-updated', label: 'Recently Updated' },
];

// ── Combobox item types ───────────────────────────────────────────────────────

type UserItem = { value: string; label: string; avatarUrl?: string };
type LabelItem = { value: string; label: string; color?: string };

function textSearch(prs: PullRequest[], query: string) {
  if (!query.trim()) return prs;
  const lower = query.trim().toLowerCase();
  return prs.filter(
    (pr) =>
      pr.title.toLowerCase().includes(lower) ||
      pr.metadata.headRefName.toLowerCase().includes(lower) ||
      String(pr.metadata.number).includes(lower)
  );
}

// ── Single-select combobox for users (author / assignee) ─────────────────────

function SingleUserCombobox({
  placeholder,
  items,
  selected,
  onChange,
}: {
  placeholder: string;
  items: UserItem[];
  selected: string | null;
  onChange: (value: string | null) => void;
}) {
  const disabled = items.length === 0;
  const selectedItem = items.find((i) => i.value === selected) ?? null;

  const leftAddon = selectedItem?.avatarUrl ? (
    <img src={selectedItem.avatarUrl} alt={selectedItem.label} className="size-4 rounded-full" />
  ) : undefined;

  return (
    <Combobox
      disabled={disabled}
      value={selectedItem}
      onValueChange={(val: UserItem | null) => onChange(val?.value ?? null)}
      items={items}
      isItemEqualToValue={(a: UserItem, b: UserItem) => a.value === b.value}
      filter={(item: UserItem, query: string) =>
        item.label.toLowerCase().includes(query.toLowerCase())
      }
    >
      <ComboboxInput
        className="h-8 text-xs"
        placeholder={placeholder}
        showClear={!!selectedItem}
        leftAddon={leftAddon}
        disabled={disabled}
      />
      <ComboboxContent className="min-w-48">
        <ComboboxList>
          <ComboboxCollection>
            {(item: UserItem) => (
              <ComboboxItem key={item.value} value={item}>
                {item.avatarUrl ? (
                  <img src={item.avatarUrl} alt={item.label} className="size-4 rounded-full" />
                ) : (
                  <span className="size-4 rounded-full bg-muted shrink-0" />
                )}
                {item.label}
              </ComboboxItem>
            )}
          </ComboboxCollection>
          <ComboboxEmpty>No results</ComboboxEmpty>
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

// ── Multi-select combobox for labels ─────────────────────────────────────────

function LabelCombobox({
  items,
  selected,
  onChange,
}: {
  items: LabelItem[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const anchor = useComboboxAnchor();
  const disabled = items.length === 0;
  const selectedItems = items.filter((i) => selected.includes(i.value));

  return (
    <Combobox
      multiple
      disabled={disabled}
      value={selectedItems}
      onValueChange={(vals: LabelItem[]) => onChange(vals.map((v) => v.value))}
      items={items}
      isItemEqualToValue={(a: LabelItem, b: LabelItem) => a.value === b.value}
      filter={(item: LabelItem, query: string) =>
        item.label.toLowerCase().includes(query.toLowerCase())
      }
    >
      <ComboboxChips ref={anchor} className="min-h-8 text-xs">
        {selectedItems.map((item) => (
          <ComboboxChip key={item.value}>
            {item.color && (
              <span
                className="size-2 rounded-full shrink-0"
                style={{ backgroundColor: `#${item.color}` }}
              />
            )}
            {item.label}
          </ComboboxChip>
        ))}
        <ComboboxChipsInput placeholder={selectedItems.length === 0 ? 'Label' : ''} />
      </ComboboxChips>
      <ComboboxContent anchor={anchor} className="min-w-48">
        <ComboboxList>
          <ComboboxCollection>
            {(item: LabelItem) => (
              <ComboboxItem key={item.value} value={item}>
                {item.color && (
                  <span
                    className="size-3 rounded-full shrink-0"
                    style={{ backgroundColor: `#${item.color}` }}
                  />
                )}
                {item.label}
              </ComboboxItem>
            )}
          </ComboboxCollection>
          <ComboboxEmpty>No results</ComboboxEmpty>
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export const PullRequestList = observer(function PullRequestList() {
  const {
    params: { projectId },
  } = useParams('project');
  const project = mountedProjectData(getProjectStore(projectId));
  const nameWithOwner = project?.gitRemote ? parseGithubNameWithOwner(project.gitRemote) : null;

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [sortFilter, setSortFilter] = useState<PrSortField>('newest');
  const [selectedAuthorLogin, setSelectedAuthorLogin] = useState<string | null>(null);
  const [selectedLabelNames, setSelectedLabelNames] = useState<string[]>([]);
  const [selectedAssigneeLogin, setSelectedAssigneeLogin] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [syncing, setSyncing] = useState(false);

  const sentinelRef = useRef<HTMLDivElement>(null);

  const filters: PrFilters = {
    status: statusFilter,
    ...(selectedAuthorLogin ? { authorLogins: [selectedAuthorLogin] } : {}),
    ...(selectedLabelNames.length > 0 ? { labelNames: selectedLabelNames } : {}),
    ...(selectedAssigneeLogin ? { assigneeLogins: [selectedAssigneeLogin] } : {}),
  };

  const { prs, refresh, loading, fetchNextPage, hasNextPage, isFetchingNextPage } = usePullRequests(
    projectId,
    nameWithOwner ?? undefined,
    { filters, sort: sortFilter }
  );

  const { data: filterOptions } = useFilterOptions(projectId, nameWithOwner ?? undefined);

  // Infinite scroll sentinel
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const filteredPrs = useMemo(() => textSearch(prs, deferredQuery), [prs, deferredQuery]);

  const handleStatusChange = (value: StatusFilter) => {
    setStatusFilter(value);
  };

  const handleSortChange = (value: string | null) => {
    if (!value) return;
    setSortFilter(value as PrSortField);
  };

  const handleRefresh = async () => {
    setSyncing(true);
    try {
      await refresh();
    } finally {
      setSyncing(false);
    }
  };

  const hasActiveFilters =
    selectedAuthorLogin !== null || selectedLabelNames.length > 0 || selectedAssigneeLogin !== null;

  const clearFilters = () => {
    setSelectedAuthorLogin(null);
    setSelectedLabelNames([]);
    setSelectedAssigneeLogin(null);
  };

  // Build combobox items from filter options
  const authorItems: UserItem[] = (filterOptions?.authors ?? []).map((a) => ({
    value: a.userName,
    label: a.displayName,
    avatarUrl: a.avatarUrl,
  }));

  const assigneeItems: UserItem[] = (filterOptions?.assignees ?? []).map((a) => ({
    value: a.userName,
    label: a.displayName ?? a.userName,
    avatarUrl: a.avatarUrl,
  }));

  const labelItems: LabelItem[] = (filterOptions?.labels ?? []).map((l) => ({
    value: l.name,
    label: l.name,
    color: l.color,
  }));

  return (
    <div className="flex flex-col gap-4 max-w-3xl mx-auto w-full pt-10 px-1 min-h-0">
      <div className="flex items-center gap-2 py-3 shrink-0 flex-wrap justify-between">
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
          <Button variant="outline" size="icon-sm" onClick={handleRefresh} disabled={syncing}>
            <motion.div
              animate={syncing ? { rotate: 360 } : {}}
              transition={syncing ? { repeat: Infinity, duration: 0.8, ease: 'linear' } : {}}
            >
              <RefreshCw className="size-3.5" />
            </motion.div>
          </Button>
        </div>
      </div>

      {/* Row 2: Dimension filters (author / label / assignee) */}
      <div className="flex items-start gap-2 pb-3 shrink-0 flex-wrap">
        <Select value={sortFilter} onValueChange={handleSortChange}>
          <SelectTrigger size="sm" className="w-auto">
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
        <div className="w-44">
          <SingleUserCombobox
            placeholder="Author"
            items={authorItems}
            selected={selectedAuthorLogin}
            onChange={setSelectedAuthorLogin}
          />
        </div>
        <div className="w-44">
          <LabelCombobox
            items={labelItems}
            selected={selectedLabelNames}
            onChange={setSelectedLabelNames}
          />
        </div>
        <div className="w-44">
          <SingleUserCombobox
            placeholder="Assigned to"
            items={assigneeItems}
            selected={selectedAssigneeLogin}
            onChange={setSelectedAssigneeLogin}
          />
        </div>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1 self-center">
            <X className="size-3" />
            Clear
          </Button>
        )}
      </div>

      {/* PR list */}
      <div className="space-y-2 overflow-y-auto min-h-0 flex-1" style={{ scrollbarWidth: 'none' }}>
        {loading && filteredPrs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">Loading…</p>
        ) : filteredPrs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No PRs match this filter.
          </p>
        ) : (
          <>
            {filteredPrs.map((pr) => (
              <PrRow key={pr.metadata.number} pr={pr} />
            ))}
            {/* Infinite scroll sentinel */}
            <div ref={sentinelRef} className="py-1">
              {isFetchingNextPage && (
                <p className="text-xs text-muted-foreground text-center">Loading more…</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
});
