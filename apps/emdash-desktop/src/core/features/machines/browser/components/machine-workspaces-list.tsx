import {
  createListView,
  createTextMatcher,
  defineFilter,
  defineSearch,
  defineSelection,
  ListView,
} from '@emdash/ui/react/patterns';
import { createLiveJobReplica } from '@emdash/wire';
import { useQueryClient } from '@tanstack/react-query';
import {
  FilterIcon,
  FolderGit2Icon,
  GitBranchIcon,
  HardDriveIcon,
  PlusIcon,
  PowerIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import { makeAutoObservable, observable } from 'mobx';
import type { ObservableMap } from 'mobx';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getWorkspacesWireClient } from '@core/features/workspaces/api/browser/client';
import { workspacesWireContract } from '@core/features/workspaces/api/wire-contract';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { Button } from '@core/primitives/ui/browser/button';
import { Checkbox } from '@core/primitives/ui/browser/checkbox';
import { cn } from '@core/primitives/ui/browser/cn';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@core/primitives/ui/browser/dropdown-menu';
import { SearchInput } from '@core/primitives/ui/browser/search-input';
import { Spinner } from '@core/primitives/ui/browser/spinner';
import { toast } from '@core/primitives/ui/browser/use-toast';
import type {
  ProjectWorkspaceActionResult,
  ProjectWorkspaceActionSummary,
  ProjectWorkspaceRow,
} from '@core/primitives/workspaces/api';
import {
  deleteMachineProjectWorkspaces,
  useMachineWorkspaces,
  type MachineProjectWorkspaces,
} from '../use-machine-workspaces';
import {
  useWorkspaceRuntimeStatuses,
  type WorkspaceRuntimeStatus,
} from '../use-workspace-runtime-statuses';
import { formatBytes } from './machine-resources';

type UsageFilter = 'all' | 'used' | 'unused';
type StatusFilter = 'all' | WorkspaceRuntimeStatus;
type PendingAction = 'clean' | 'teardown' | 'delete';

type MachineWorkspaceItem = {
  projectId: string;
  projectName: string;
  row: ProjectWorkspaceRow;
};

class MachineWorkspacesListStore {
  items: MachineWorkspaceItem[] = [];

  constructor() {
    makeAutoObservable(this, { items: observable.ref }, { autoBind: true });
  }

  setItems(items: MachineWorkspaceItem[]): void {
    this.items = items;
  }
}

function createMachineWorkspacesListView(
  store: MachineWorkspacesListStore,
  statuses: ObservableMap<string, WorkspaceRuntimeStatus>
) {
  const matcher = createTextMatcher<MachineWorkspaceItem>((item) => [
    item.projectName,
    item.row.path,
    item.row.branch ?? '',
    ...item.row.tasks.map((task) => task.name),
  ]);

  return createListView({
    getItemId: getItemId,
    source: {
      kind: 'sync',
      items: () => store.items,
    },
    search: defineSearch<MachineWorkspaceItem>({
      kind: 'sync',
      predicate: matcher,
    }),
    filter: defineFilter<MachineWorkspaceItem, { usage: UsageFilter; status: StatusFilter }>({
      kind: 'sync',
      initial: { usage: 'all', status: 'all' },
      apply: (item, model) => {
        const used = item.row.kind === 'root' || item.row.tasks.length > 0;
        if (model.usage === 'used' && !used) return false;
        if (model.usage === 'unused' && used) return false;
        if (model.status !== 'all' && workspaceStatus(item.row, statuses) !== model.status) {
          return false;
        }
        return true;
      },
    }),
    sections: {
      by: (item) => item.projectId,
    },
    selection: defineSelection({ kind: 'multi' }),
  });
}

type MachineWorkspacesListView = ReturnType<typeof createMachineWorkspacesListView>;

export const MachineWorkspacesList = observer(function MachineWorkspacesList({
  machineId,
  connectionId,
  enabled,
}: {
  machineId: string;
  connectionId: string;
  enabled: boolean;
}) {
  const workspaces = useMachineWorkspaces(machineId, enabled);
  const items = useMemo(() => flattenWorkspaces(workspaces.data ?? []), [workspaces.data]);
  const statusInputs = useMemo(
    () =>
      items.map((item) => ({
        workspaceId: item.row.workspaceId,
        hasActiveSessions: item.row.hasActiveSessions,
      })),
    [items]
  );
  const statuses = useWorkspaceRuntimeStatuses(statusInputs);
  const store = useMemo(() => new MachineWorkspacesListStore(), []);
  const view = useMemo(() => createMachineWorkspacesListView(store, statuses), [statuses, store]);

  useEffect(() => {
    store.setItems(items);
  }, [items, store]);

  return (
    <view.Root>
      <section className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-background-1">
        <MachineWorkspacesHeader view={view} connectionId={connectionId} />
        <MachineWorkspacesSelectionBar view={view} machineId={machineId} />
        <ListView.Body className="min-h-60 flex-1">
          {workspaces.isLoading ? (
            <WorkspacesLoadingState />
          ) : workspaces.isError ? (
            <WorkspacesErrorState error={workspaces.error} />
          ) : (
            <view.List
              virtualization={{ estimateSize: 48, estimateHeaderSize: 48, overscan: 8 }}
              emptySlot={<WorkspacesEmptyState />}
              renderSection={() => <ProjectSectionHeader view={view} />}
              renderItem={(item) => <WorkspaceRow view={view} item={item} statuses={statuses} />}
            />
          )}
        </ListView.Body>
      </section>
    </view.Root>
  );
});

const MachineWorkspacesHeader = observer(function MachineWorkspacesHeader({
  view,
  connectionId,
}: {
  view: MachineWorkspacesListView;
  connectionId: string;
}) {
  const list = view.useListView();
  const search = view.useSearch();
  const filter = view.useFilter();
  const selection = view.useSelection();
  const openAddProject = useOpenModal('addProjectModal');
  const visibleIds = list.orderedIds;
  const selectedVisibleCount = visibleIds.filter((id) => selection.isSelected(id)).length;
  const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
      <Checkbox
        aria-label="Select all visible workspaces"
        aria-checked={someVisibleSelected ? 'mixed' : allVisibleSelected}
        checked={allVisibleSelected}
        disabled={visibleIds.length === 0}
        onCheckedChange={() => setIdsSelected(selection, visibleIds, !allVisibleSelected)}
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button type="button" variant="outline" size="sm">
              <FilterIcon className="size-3.5" />
              Filters
            </Button>
          }
        />
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuRadioGroup
            value={filter.model.usage}
            onValueChange={(usage) => filter.set({ usage: usage as UsageFilter })}
          >
            <DropdownMenuLabel>Usage</DropdownMenuLabel>
            <DropdownMenuRadioItem value="all">All</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="used">Used</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="unused">Unused</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            value={filter.model.status}
            onValueChange={(status) => filter.set({ status: status as StatusFilter })}
          >
            <DropdownMenuLabel>Status</DropdownMenuLabel>
            <DropdownMenuRadioItem value="all">All</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="idle">Idle</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="setting-up">Setting up...</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="active">Active</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="tearing-down">Tearing Down...</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <SearchInput
        containerClassName="min-w-48 flex-1"
        className="h-8"
        placeholder="Search workspaces, branches, tasks..."
        value={search.query}
        onChange={(event) => search.setQuery(event.target.value)}
      />
      <Button
        type="button"
        size="sm"
        onClick={() => void openAddProject({ strategy: 'ssh', mode: 'clone', connectionId })}
      >
        <PlusIcon className="size-3.5" />
        Add Project
      </Button>
    </div>
  );
});

const ProjectSectionHeader = observer(function ProjectSectionHeader({
  view,
}: {
  view: MachineWorkspacesListView;
}) {
  const section = view.useSection();
  const selection = view.useSelection();
  const ids = section.items.map(getItemId);
  const selectedCount = ids.filter((id) => selection.isSelected(id)).length;
  const allSelected = ids.length > 0 && selectedCount === ids.length;
  const someSelected = selectedCount > 0 && !allSelected;
  const first = section.items[0];
  const root = section.items.find((item) => item.row.kind === 'root');

  if (!first) return null;

  return (
    <div className="flex items-center gap-3 border-b border-border bg-background px-3 py-2 text-sm">
      <Checkbox
        aria-label={`Select ${first.projectName} workspaces`}
        aria-checked={someSelected ? 'mixed' : allSelected}
        checked={allSelected}
        onCheckedChange={() => setIdsSelected(selection, ids, !allSelected)}
      />
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-background-2 text-foreground-muted">
        <FolderGit2Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground">{first.projectName}</div>
        <div className="truncate text-xs text-foreground-passive">
          {root?.row.path ?? first.row.path}
        </div>
      </div>
      <span className="text-xs text-foreground-passive tabular-nums">
        {section.count} {section.count === 1 ? 'workspace' : 'workspaces'}
      </span>
    </div>
  );
});

const WorkspaceRow = observer(function WorkspaceRow({
  view,
  item,
  statuses,
}: {
  view: MachineWorkspacesListView;
  item: MachineWorkspaceItem;
  statuses: ObservableMap<string, WorkspaceRuntimeStatus>;
}) {
  const selection = view.useSelection();
  const id = getItemId(item);
  const selected = selection.isSelected(id);
  const status = workspaceStatus(item.row, statuses);

  return (
    <ListView.Row
      bare
      interactive
      selected={false}
      className={cn(selected ? 'bg-background-2' : 'hover:bg-background-1')}
      onClick={(event) => selection.toggle(id, event)}
    >
      <div className="flex min-h-12 items-center gap-3 border-b border-border px-3 py-2 pl-10 text-sm">
        <Checkbox
          aria-label={`Select ${workspaceLabel(item.row)}`}
          checked={selected}
          onClick={(event) => event.stopPropagation()}
          onCheckedChange={() => selection.toggle(id)}
        />
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-background-2 text-foreground-muted">
          {item.row.kind === 'root' ? (
            <FolderGit2Icon className="size-4" />
          ) : (
            <GitBranchIcon className="size-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-foreground">{workspaceLabel(item.row)}</div>
          <div className="truncate text-xs text-foreground-passive">{item.row.path}</div>
        </div>
        <TasksPill count={item.row.tasks.length} />
        <StatusPill status={status} />
      </div>
    </ListView.Row>
  );
});

const MachineWorkspacesSelectionBar = observer(function MachineWorkspacesSelectionBar({
  view,
  machineId,
}: {
  view: MachineWorkspacesListView;
  machineId: string;
}) {
  const queryClient = useQueryClient();
  const openConfirm = useOpenModal('confirmActionModal');
  const list = view.useListView();
  const selection = view.useSelection();
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const selectedItems = list.visibleItems.filter((item) =>
    selection.selectedIds.has(getItemId(item))
  );
  const cleanableItems = selectedItems.filter(
    (item) => item.row.workspaceId && item.row.canCleanArtifacts
  );
  const teardownItems = selectedItems.filter((item) => item.row.workspaceId);
  const deletableItems = selectedItems.filter((item) => item.row.canDelete);
  const selectedArtifactBytes = cleanableItems.reduce(
    (sum, item) => sum + (item.row.usage?.artifactBytes ?? 0),
    0
  );

  const runAction = useCallback(
    async (kind: PendingAction, items: MachineWorkspaceItem[]) => {
      if (items.length === 0) return;
      setPendingAction(kind);
      try {
        const result =
          kind === 'clean'
            ? await cleanWorkspaceArtifacts(items)
            : kind === 'teardown'
              ? await teardownWorkspaces(items)
              : await deleteWorkspaces(items);
        showActionResult(kind, result);
        if (result.failedCount === 0) selection.clear();
        await queryClient.invalidateQueries({ queryKey: ['machineWorkspaces', machineId] });
      } catch (error) {
        toast({
          title: actionFailureTitle(kind),
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        });
      } finally {
        setPendingAction(null);
      }
    },
    [machineId, queryClient, selection]
  );

  const confirmAction = useCallback(
    (kind: PendingAction, items: MachineWorkspaceItem[]) => {
      if (items.length === 0) return;
      const count = workspaceCount(items.length);
      void openConfirm({
        title:
          kind === 'clean'
            ? `Delete artifacts for ${count}?`
            : kind === 'teardown'
              ? `Teardown ${count}?`
              : `Delete ${count}?`,
        description:
          kind === 'clean'
            ? 'This removes gitignored dependencies, build output, and caches from selected workspaces.'
            : kind === 'teardown'
              ? 'This stops runtime activity and runs teardown for selected workspaces.'
              : 'This deletes selected workspaces and linked task worktrees where supported.',
        confirmLabel:
          kind === 'clean' ? 'Delete Artifacts' : kind === 'teardown' ? 'Teardown' : 'Delete',
        variant: kind === 'delete' ? 'destructive' : undefined,
      }).then((outcome) => {
        if (outcome.success) void runAction(kind, items);
      });
    },
    [openConfirm, runAction]
  );

  if (selection.count === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background-2 px-3 py-2">
      <div className="flex min-w-0 items-center gap-3 text-xs text-foreground-muted">
        <span className="whitespace-nowrap">{selectedItems.length} selected</span>
        <span className="inline-flex items-center gap-1">
          <HardDriveIcon className="size-3.5" />
          {formatBytes(selectedArtifactBytes)} artifacts
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={cleanableItems.length === 0 || pendingAction !== null}
          onClick={() => confirmAction('clean', cleanableItems)}
        >
          {pendingAction === 'clean' ? (
            <Spinner className="size-3.5" />
          ) : (
            <HardDriveIcon className="size-3.5" />
          )}
          Delete Artifacts
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={teardownItems.length === 0 || pendingAction !== null}
          onClick={() => confirmAction('teardown', teardownItems)}
        >
          {pendingAction === 'teardown' ? (
            <Spinner className="size-3.5" />
          ) : (
            <PowerIcon className="size-3.5" />
          )}
          Teardown
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={deletableItems.length === 0 || pendingAction !== null}
          onClick={() => confirmAction('delete', deletableItems)}
        >
          {pendingAction === 'delete' ? (
            <Spinner className="size-3.5" />
          ) : (
            <Trash2Icon className="size-3.5" />
          )}
          Delete
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => selection.clear()}
          aria-label="Clear selection"
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  );
});

function WorkspacesLoadingState() {
  return (
    <div className="flex h-40 items-center justify-center gap-2 text-sm text-foreground-muted">
      <Spinner className="size-4" />
      Loading workspaces
    </div>
  );
}

function WorkspacesErrorState({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex h-40 flex-col items-center justify-center gap-1 text-sm">
      <div className="text-foreground-destructive">Could not load workspaces.</div>
      <div className="max-w-md text-center text-xs text-foreground-muted">{message}</div>
    </div>
  );
}

function WorkspacesEmptyState() {
  return (
    <div className="flex h-40 items-center justify-center text-sm text-foreground-muted">
      No workspaces match the current filters.
    </div>
  );
}

function TasksPill({ count }: { count: number }) {
  return (
    <span className="shrink-0 rounded-full border border-border/70 px-1.5 py-0.5 text-[10px] tracking-wide text-foreground-muted uppercase tabular-nums">
      {count} {count === 1 ? 'task' : 'tasks'}
    </span>
  );
}

function StatusPill({ status }: { status: WorkspaceRuntimeStatus }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] tracking-wide uppercase tabular-nums',
        status === 'active' && 'border-border-success text-foreground-success',
        status === 'idle' && 'border-border/70 text-foreground-muted',
        status === 'setting-up' && 'animate-pulse border-border-info text-foreground-info',
        status === 'tearing-down' && 'animate-pulse border-border-warning text-foreground-warning'
      )}
    >
      {statusLabel(status)}
    </span>
  );
}

function flattenWorkspaces(groups: MachineProjectWorkspaces[]): MachineWorkspaceItem[] {
  return groups.flatMap(({ project, workspaces }) =>
    workspaces.map((row) => ({
      projectId: project.id,
      projectName: project.name,
      row,
    }))
  );
}

function workspaceStatus(
  row: ProjectWorkspaceRow,
  statuses: ObservableMap<string, WorkspaceRuntimeStatus>
): WorkspaceRuntimeStatus {
  if (!row.workspaceId) return row.hasActiveSessions ? 'active' : 'idle';
  return statuses.get(row.workspaceId) ?? (row.hasActiveSessions ? 'active' : 'idle');
}

function workspaceLabel(workspace: ProjectWorkspaceRow): string {
  if (workspace.kind === 'root') return 'Repository root';
  if (workspace.tasks[0]?.name) return workspace.tasks[0].name;
  if (workspace.branch) return workspace.branch;
  return basename(workspace.path);
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function getItemId(item: MachineWorkspaceItem): string {
  return `${item.projectId}:${item.row.path}`;
}

function setIdsSelected(
  selection: ReturnType<MachineWorkspacesListView['useSelection']>,
  ids: string[],
  selected: boolean
) {
  for (const id of ids) {
    if (selection.isSelected(id) !== selected) {
      selection.toggle(id);
    }
  }
}

async function cleanWorkspaceArtifacts(
  items: MachineWorkspaceItem[]
): Promise<ProjectWorkspaceActionSummary> {
  const client = await getWorkspacesWireClient();
  const jobs = createLiveJobReplica(workspacesWireContract.cleanArtifacts, client.cleanArtifacts);
  const results: ProjectWorkspaceActionResult[] = [];
  try {
    for (const item of items) {
      if (!item.row.workspaceId) continue;
      let lease: Awaited<ReturnType<typeof jobs.start>> | null = null;
      try {
        lease = await jobs.start({ workspaceId: item.row.workspaceId, preservePatterns: [] });
        const job = await lease.ready();
        const result = await job.result;
        results.push({
          path: item.row.path,
          workspaceId: item.row.workspaceId,
          success: true,
          reclaimedBytes: result.reclaimedBytes,
        });
      } catch (error) {
        results.push(actionFailure(item.row, 'clean-failed', error));
      } finally {
        await lease?.release();
      }
    }
  } finally {
    await jobs.dispose();
  }
  return summarizeResults(results);
}

async function teardownWorkspaces(
  items: MachineWorkspaceItem[]
): Promise<ProjectWorkspaceActionSummary> {
  const client = await getWorkspacesWireClient();
  const jobs = createLiveJobReplica(workspacesWireContract.teardown, client.teardown);
  const results: ProjectWorkspaceActionResult[] = [];
  try {
    for (const item of items) {
      if (!item.row.workspaceId) continue;
      let lease: Awaited<ReturnType<typeof jobs.start>> | null = null;
      try {
        lease = await jobs.start({ workspaceId: item.row.workspaceId, force: false });
        const job = await lease.ready();
        await job.result;
        results.push({
          path: item.row.path,
          workspaceId: item.row.workspaceId,
          success: true,
        });
      } catch (error) {
        results.push(actionFailure(item.row, 'clean-failed', error));
      } finally {
        await lease?.release();
      }
    }
  } finally {
    await jobs.dispose();
  }
  return summarizeResults(results);
}

async function deleteWorkspaces(
  items: MachineWorkspaceItem[]
): Promise<ProjectWorkspaceActionSummary> {
  const results: ProjectWorkspaceActionResult[] = [];
  for (const [projectId, projectItems] of groupByProject(items)) {
    try {
      const result = await deleteMachineProjectWorkspaces({
        projectId,
        paths: projectItems.map((item) => item.row.path),
      });
      results.push(...result.results);
    } catch (error) {
      results.push(...projectItems.map((item) => actionFailure(item.row, 'delete-failed', error)));
    }
  }
  return summarizeResults(results);
}

function groupByProject(items: MachineWorkspaceItem[]): Map<string, MachineWorkspaceItem[]> {
  const groups = new Map<string, MachineWorkspaceItem[]>();
  for (const item of items) {
    const group = groups.get(item.projectId) ?? [];
    group.push(item);
    groups.set(item.projectId, group);
  }
  return groups;
}

function actionFailure(
  row: ProjectWorkspaceRow,
  reason: 'clean-failed' | 'delete-failed',
  error: unknown
): ProjectWorkspaceActionResult {
  return {
    path: row.path,
    workspaceId: row.workspaceId ?? undefined,
    success: false,
    reason,
    message: error instanceof Error ? error.message : String(error),
  };
}

function summarizeResults(results: ProjectWorkspaceActionResult[]): ProjectWorkspaceActionSummary {
  const succeededCount = results.filter((result) => result.success).length;
  return {
    succeededCount,
    failedCount: results.length - succeededCount,
    results,
  };
}

function showActionResult(kind: PendingAction, result: ProjectWorkspaceActionSummary): void {
  if (result.failedCount > 0) {
    const firstFailure = result.results.find((item) => !item.success);
    toast({
      title: `${result.succeededCount} succeeded, ${result.failedCount} failed`,
      description: firstFailure && !firstFailure.success ? firstFailure.message : undefined,
      variant: 'destructive',
    });
    return;
  }

  toast({
    title:
      kind === 'clean'
        ? `Deleted artifacts for ${workspaceCount(result.succeededCount)}`
        : kind === 'teardown'
          ? `Tore down ${workspaceCount(result.succeededCount)}`
          : `Deleted ${workspaceCount(result.succeededCount)}`,
  });
}

function actionFailureTitle(kind: PendingAction): string {
  switch (kind) {
    case 'clean':
      return 'Could not delete artifacts';
    case 'teardown':
      return 'Could not teardown workspaces';
    case 'delete':
      return 'Could not delete workspaces';
  }
}

function statusLabel(status: WorkspaceRuntimeStatus): string {
  switch (status) {
    case 'idle':
      return 'Idle';
    case 'setting-up':
      return 'Setting up...';
    case 'active':
      return 'Active';
    case 'tearing-down':
      return 'Tearing Down...';
  }
}

function workspaceCount(count: number): string {
  return `${count} ${count === 1 ? 'workspace' : 'workspaces'}`;
}
