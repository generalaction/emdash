import { CollectionToolbar, CollectionView, SortSelect } from '@emdash/ui/react/patterns';
import { Button, ContextMenu, Input, Popover, ToggleGroup } from '@emdash/ui/react/primitives';
import { CheckIcon, ChevronDownIcon, RefreshCw, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { motion } from 'motion/react';
import { useState } from 'react';
import {
  GitHubAccountStateEmpty,
  useBlockingGitHubAccountState,
} from '@core/features/github/contributions/browser/account-state';
import type { UserItem } from '@core/features/projects/browser/components/pr-view/pr-filter-items';
import {
  usePrViewState,
  type LabelItem,
  type StatusFilter,
} from '@core/features/projects/browser/components/pr-view/usePrViewState';
import { projectViewDef } from '@core/features/projects/contributions/views';
import { getGitRepositoryStore } from '@core/features/source-control/api/browser/stores/source-control-selectors';
import { useSearchFocusHotkeys } from '@core/primitives/keybindings/browser';
import { useCurrentViewParams } from '@core/primitives/navigation/browser/navigation-hooks';
import {
  usePullRequestsStore,
  type PullRequestListView,
} from '@root/src/core/services/pull-requests/browser';
import { PrRow } from './pr-row';
import { ProjectPullRequestsProvider } from './pr-store-provider';
import { PrSyncStatusCard } from './pr-sync-status-card';

function FilterButton({
  label,
  active,
  disabled,
  children,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger
        disabled={disabled}
        className={
          'flex items-center gap-1 text-sm hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40' +
          (active ? 'font-medium text-foreground' : 'text-foreground-muted')
        }
      >
        {label}
        <ChevronDownIcon className="size-3.5" />
      </Popover.Trigger>
      <Popover.Content align="start" className="w-56 gap-0 p-2">
        {children}
      </Popover.Content>
    </Popover.Root>
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

  return (
    <FilterButton label={label} active={selected !== null} disabled={items.length === 0}>
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

  return (
    <FilterButton label="Label" active={selected.length > 0} disabled={items.length === 0}>
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
  } = useCurrentViewParams(projectViewDef);
  const repositoryStore = getGitRepositoryStore(projectId);
  const repositoryUrl = repositoryStore?.pullRequestRepositoryUrl ?? null;
  // §7 reporting matrix (spec: github-git-settings §7): explicit none is a
  // quiet disabled state, an unresolvable pin fails closed with a fix
  // affordance, and the zero-account case offers the connect flow. The
  // silent-default row renders the normal PR list.
  const accountState = useBlockingGitHubAccountState(projectId);

  if (accountState) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col justify-center">
        <GitHubAccountStateEmpty state={accountState} projectId={projectId} />
      </div>
    );
  }

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
    <ProjectPullRequestsProvider repositoryUrls={[repositoryUrl]}>
      <PullRequestViewContent projectId={projectId} repositoryUrl={repositoryUrl} />
    </ProjectPullRequestsProvider>
  );
});

/** The shared sort control, bound to the view's sort slice (needs Root context). */
const PrSortSelect = observer(function PrSortSelect({ view }: { view: PullRequestListView }) {
  const sort = view.useSort();
  return <SortSelect sort={sort} />;
});

function PrErrorState({ error }: { error: string | null }) {
  return (
    <div className="flex flex-col items-center gap-1 p-6 text-center">
      <p className="text-sm font-medium">Could not load pull requests</p>
      {error && <p className="text-sm text-foreground-muted">{error}</p>}
    </div>
  );
}

const PullRequestViewContent = observer(function PullRequestViewContent({
  projectId,
  repositoryUrl,
}: {
  projectId: string;
  repositoryUrl: string;
}) {
  const store = usePullRequestsStore();
  const view = store.listView;
  const {
    statusFilter,
    syncing,
    selectedAuthorLogin,
    setSelectedAuthorLogin,
    selectedLabelNames,
    setSelectedLabelNames,
    selectedAssigneeLogin,
    setSelectedAssigneeLogin,
    handleStatusChange,
    handleRefresh,
    handleForceFullSync,
    removeLabel,
    prs,
    error,
    authorItems,
    assigneeItems,
    labelItems,
    selectedAuthorItem,
    selectedAssigneeItem,
    selectedLabelItems,
    hasPills,
  } = usePrViewState(repositoryUrl);

  const toolbar = (
    <PrToolbar
      view={view}
      statusFilter={statusFilter}
      syncing={syncing}
      onStatusChange={handleStatusChange}
      onRefresh={handleRefresh}
      onForceFullSync={handleForceFullSync}
      authorItems={authorItems}
      selectedAuthorLogin={selectedAuthorLogin}
      onAuthorChange={setSelectedAuthorLogin}
      labelItems={labelItems}
      selectedLabelNames={selectedLabelNames}
      onLabelChange={setSelectedLabelNames}
      assigneeItems={assigneeItems}
      selectedAssigneeLogin={selectedAssigneeLogin}
      onAssigneeChange={setSelectedAssigneeLogin}
      selectedAuthorItem={selectedAuthorItem}
      selectedAssigneeItem={selectedAssigneeItem}
      selectedLabelItems={selectedLabelItems}
      hasPills={hasPills}
      onRemoveLabel={removeLabel}
    />
  );

  return (
    <view.Root>
      <CollectionView
        view={view}
        renderRow={(pr) => (
          <div className="group w-full">
            <PrRow pr={pr} projectId={projectId} />
          </div>
        )}
        estimateSize={84}
        toolbar={toolbar}
        footer={
          <PrSyncStatusCard
            repositoryUrl={repositoryUrl}
            manualError={prs.length > 0 ? error : null}
          />
        }
        errorSlot={<PrErrorState error={error} />}
        emptySlot={
          error ? (
            <PrErrorState error={error} />
          ) : (
            <div className="flex flex-col items-center gap-1 p-6 text-center">
              <p className="text-sm font-medium">No pull requests</p>
              <p className="text-sm text-foreground-muted">
                No pull requests available or none that match this filter
              </p>
            </div>
          )
        }
      />
    </view.Root>
  );
});

const PrToolbar = observer(function PrToolbar({
  view,
  statusFilter,
  syncing,
  onStatusChange,
  onRefresh,
  onForceFullSync,
  authorItems,
  selectedAuthorLogin,
  onAuthorChange,
  labelItems,
  selectedLabelNames,
  onLabelChange,
  assigneeItems,
  selectedAssigneeLogin,
  onAssigneeChange,
  selectedAuthorItem,
  selectedAssigneeItem,
  selectedLabelItems,
  hasPills,
  onRemoveLabel,
}: {
  view: PullRequestListView;
  statusFilter: StatusFilter;
  syncing: boolean;
  onStatusChange: (status: StatusFilter) => void;
  onRefresh: () => void;
  onForceFullSync: () => void;
  authorItems: UserItem[];
  selectedAuthorLogin: string | null;
  onAuthorChange: (value: string | null) => void;
  labelItems: LabelItem[];
  selectedLabelNames: string[];
  onLabelChange: (values: string[]) => void;
  assigneeItems: UserItem[];
  selectedAssigneeLogin: string | null;
  onAssigneeChange: (value: string | null) => void;
  selectedAuthorItem: UserItem | undefined;
  selectedAssigneeItem: UserItem | undefined;
  selectedLabelItems: LabelItem[];
  hasPills: boolean;
  onRemoveLabel: (value: string) => void;
}) {
  const searchRef = useSearchFocusHotkeys();
  const search = view.useSearch();

  return (
    <div className="flex flex-col gap-3">
      {/* Primary row: status tabs, search, refresh. */}
      <CollectionToolbar.Root>
        <ToggleGroup.Root
          value={[statusFilter]}
          onValueChange={(values) => {
            const next = values.find((v) => v !== statusFilter) ?? statusFilter;
            onStatusChange(next as StatusFilter);
          }}
        >
          <ToggleGroup.Item value="open">Open</ToggleGroup.Item>
          <ToggleGroup.Item value="not-open">Closed</ToggleGroup.Item>
        </ToggleGroup.Root>
        <CollectionToolbar.Spacer />
        <CollectionToolbar.Search
          ref={searchRef}
          value={search.query}
          onValueChange={search.setQuery}
          placeholder="Search by title, branch, or number..."
        />
        <CollectionToolbar.Group>
          <ContextMenu.Root>
            <ContextMenu.Trigger>
              <Button variant="secondary" icon onClick={onRefresh} disabled={syncing}>
                <motion.div
                  animate={syncing ? { rotate: 360 } : {}}
                  transition={syncing ? { repeat: Infinity, duration: 0.8, ease: 'linear' } : {}}
                >
                  <RefreshCw className="size-3.5" />
                </motion.div>
              </Button>
            </ContextMenu.Trigger>
            <ContextMenu.Content>
              <ContextMenu.Item onClick={onForceFullSync} disabled={syncing}>
                <RefreshCw className="size-4" />
                Force full sync
              </ContextMenu.Item>
            </ContextMenu.Content>
          </ContextMenu.Root>
        </CollectionToolbar.Group>
      </CollectionToolbar.Root>

      {/* Secondary row: sort and filters. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-foreground-passive">Sort</span>
          <PrSortSelect view={view} />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-foreground-passive">Filter by</span>
          <UserFilterPopover
            label="Author"
            items={authorItems}
            selected={selectedAuthorLogin}
            onChange={onAuthorChange}
          />
          <LabelFilterPopover
            items={labelItems}
            selected={selectedLabelNames}
            onChange={onLabelChange}
          />
          <UserFilterPopover
            label="Assignee"
            items={assigneeItems}
            selected={selectedAssigneeLogin}
            onChange={onAssigneeChange}
          />
        </div>
      </div>

      {hasPills && (
        <div className="flex flex-wrap items-center gap-1.5">
          {selectedAuthorItem && (
            <FilterPill
              label={selectedAuthorItem.label}
              avatarUrl={selectedAuthorItem.avatarUrl}
              onRemove={() => onAuthorChange(null)}
            />
          )}
          {selectedLabelItems.map((l) => (
            <FilterPill
              key={l.value}
              label={l.label}
              color={l.color}
              onRemove={() => onRemoveLabel(l.value)}
            />
          ))}
          {selectedAssigneeItem && (
            <FilterPill
              label={selectedAssigneeItem.label}
              avatarUrl={selectedAssigneeItem.avatarUrl}
              onRemove={() => onAssigneeChange(null)}
            />
          )}
        </div>
      )}
    </div>
  );
});
