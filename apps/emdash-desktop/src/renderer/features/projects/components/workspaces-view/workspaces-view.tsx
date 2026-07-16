import {
  compareDates,
  compareNumbers,
  createListView,
  createTextMatcher,
  defineFilter,
  defineSearch,
  defineSelection,
  defineSort,
  ListView,
} from '@emdash/ui/react/patterns';
import { AlertTriangle, Archive, HardDrive, RefreshCw, Trash2, X } from 'lucide-react';
import { makeAutoObservable, observable, runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ListPopoverCard } from '@renderer/lib/components/list-popover-card';
import { PageHeader } from '@renderer/lib/components/page-header';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { getWorkspacesWireClient } from '@renderer/lib/runtime/workspaces-wire-client';
import { Button } from '@renderer/lib/ui/button';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import { SearchInput } from '@renderer/lib/ui/search-input';
import { Spinner } from '@renderer/lib/ui/spinner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { formatBytes } from '@renderer/utils/formatBytes';
import { cn } from '@renderer/utils/utils';
import type { DeletionState } from '@shared/core/operations/deletion';
import type {
  ProjectWorkspaceActionResult,
  ProjectWorkspaceActionSummary,
  ProjectWorkspacePathState,
  ProjectWorkspaceRow,
  ProjectWorkspaceUsageResult,
} from '@shared/core/workspaces/project-workspaces';
import { usePendingCleanups } from './use-pending-cleanups';

type UsageFilter = 'all' | 'used' | 'unused';
type LoadStatus = 'idle' | 'loading' | 'error';

class ProjectWorkspacesStore {
  rows: ProjectWorkspaceRow[] = [];
  warnings: string[] = [];
  status: LoadStatus = 'idle';
  measuring = false;
  error: string | null = null;
  private loadToken = 0;

  constructor(private readonly projectId: string) {
    makeAutoObservable(this, { rows: observable.ref }, { autoBind: true });
  }

  async load(): Promise<void> {
    const token = ++this.loadToken;
    runInAction(() => {
      this.status = 'loading';
      this.measuring = false;
      this.error = null;
      this.warnings = [];
      this.rows = [];
    });

    try {
      const result = await rpc.projectWorkspaces.listProjectWorkspaces(this.projectId);
      if (token !== this.loadToken) return;
      runInAction(() => {
        this.rows = result.rows;
        this.warnings = result.warnings;
        this.status = 'idle';
        this.measuring = result.rows.length > 0;
      });

      if (result.rows.length === 0) {
        runInAction(() => {
          if (token === this.loadToken) this.measuring = false;
        });
        return;
      }

      try {
        const measured = await rpc.projectWorkspaces.measureProjectWorkspaces({
          projectId: this.projectId,
          paths: result.rows.map((row) => row.path),
        });
        if (token !== this.loadToken) return;
        runInAction(() => {
          this.mergeUsageResults(measured.results);
          this.measuring = false;
        });
      } catch (error) {
        if (token !== this.loadToken) return;
        runInAction(() => {
          this.warnings = [...this.warnings, usageErrorMessage(error)];
          this.measuring = false;
        });
      }
    } catch (error) {
      if (token !== this.loadToken) return;
      runInAction(() => {
        this.status = 'error';
        this.error = error instanceof Error ? error.message : String(error);
        this.measuring = false;
      });
    }
  }

  private mergeUsageResults(results: ProjectWorkspaceUsageResult[]): void {
    const resultsByPath = new Map(results.map((result) => [result.path, result]));
    this.rows = this.rows.map((row) => {
      const result = resultsByPath.get(row.path);
      if (!result) return row;
      if (!result.success) {
        return {
          ...row,
          pathState: 'error',
          usage: null,
          errors: [
            ...row.errors,
            ...(result.errors ?? [{ path: row.path, message: result.message }]),
          ],
        };
      }
      return {
        ...row,
        pathState: result.usage.errors.length > 0 ? 'error' : row.pathState,
        usage: result.usage,
        errors: result.usage.errors,
      };
    });
  }
}

function createProjectWorkspacesListView(store: ProjectWorkspacesStore) {
  const matcher = createTextMatcher<ProjectWorkspaceRow>((row) => [
    row.path,
    row.branch ?? '',
    ...row.tasks.map((task) => task.name),
  ]);

  return createListView({
    getItemId: (row: ProjectWorkspaceRow) => row.path,
    source: {
      kind: 'sync',
      items: () => store.rows,
    },
    search: defineSearch<ProjectWorkspaceRow>({
      kind: 'sync',
      predicate: matcher,
    }),
    filter: defineFilter<ProjectWorkspaceRow, { usage: UsageFilter }>({
      kind: 'sync',
      initial: { usage: 'all' },
      apply: (row, model) => {
        const used = row.kind === 'root' || row.tasks.length > 0;
        if (model.usage === 'used') return used;
        if (model.usage === 'unused') return !used;
        return true;
      },
    }),
    sort: defineSort<ProjectWorkspaceRow, 'size' | 'activity'>({
      initial: { key: 'size', dir: 'desc' },
      keys: {
        size: {
          label: 'Size',
          compare: (left, right) =>
            compareNumbers(left.usage?.totalBytes ?? 0, right.usage?.totalBytes ?? 0),
        },
        activity: {
          label: 'Activity',
          compare: (left, right) =>
            compareDates(new Date(left.lastActivityAt ?? 0), new Date(right.lastActivityAt ?? 0)),
        },
      },
    }),
    selection: defineSelection({ kind: 'multi' }),
  });
}

type ProjectWorkspacesListView = ReturnType<typeof createProjectWorkspacesListView>;

export const WorkspacesView = observer(function WorkspacesView({
  projectId,
}: {
  projectId: string;
}) {
  const store = useMemo(() => new ProjectWorkspacesStore(projectId), [projectId]);
  const view = useMemo(() => createProjectWorkspacesListView(store), [store]);
  const pendingCleanups = usePendingCleanups(projectId);

  useEffect(() => {
    void store.load();
  }, [store]);

  return (
    <TooltipProvider delay={150}>
      <view.Root>
        <div className="relative flex h-full min-h-0 w-full flex-col">
          <WorkspacesHeader store={store} view={view} />
          <WorkspaceWarnings warnings={store.warnings} />
          <PendingCleanupsSection {...pendingCleanups} />
          <ListView.Body className="min-h-0 flex-1">
            {store.status === 'loading' && store.rows.length === 0 ? (
              <WorkspacesLoadingState />
            ) : store.status === 'error' ? (
              <WorkspacesErrorState message={store.error} />
            ) : (
              <view.List
                virtualization={{ estimateSize: 72, overscan: 8 }}
                emptySlot={
                  <div className="flex h-40 items-center justify-center text-sm text-foreground-muted">
                    No workspaces match the current filters.
                  </div>
                }
                renderItem={(row) => <WorkspaceRow view={view} row={row} />}
              />
            )}
          </ListView.Body>
          <WorkspacesSelectionBar store={store} view={view} projectId={projectId} />
        </div>
      </view.Root>
    </TooltipProvider>
  );
});

function PendingCleanupsSection({
  cleanups,
  retry,
  forget,
}: {
  cleanups: DeletionState[];
  retry(cleanup: DeletionState): Promise<void>;
  forget(cleanup: DeletionState): Promise<void>;
}) {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  if (cleanups.length === 0) return null;

  const runAction = async (action: 'retry' | 'forget', cleanup: DeletionState): Promise<void> => {
    setPendingAction(`${action}:${cleanup.operationId}`);
    try {
      await (action === 'retry' ? retry(cleanup) : forget(cleanup));
      toast({
        title: action === 'retry' ? 'Cleanup resumed' : 'Cleanup forgotten',
        description:
          action === 'retry'
            ? 'The cleanup will continue in the background.'
            : 'Emdash removed its records without deleting files on the host.',
      });
    } catch (error) {
      toast({
        title: action === 'retry' ? 'Could not resume cleanup' : 'Could not forget cleanup',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <section className="mx-4 mt-4 overflow-hidden rounded-md border border-border-warning bg-background-warning/30">
      <div className="flex items-start gap-2 border-b border-border-warning/50 px-3 py-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-foreground-warning" />
        <div>
          <h2 className="text-sm font-medium text-foreground">Pending cleanup</h2>
          <p className="text-xs text-foreground-muted">
            Review workspaces that could not be cleaned up automatically.
          </p>
        </div>
      </div>
      <div className="max-h-56 divide-y divide-border-warning/40 overflow-y-auto">
        {cleanups.map((cleanup) => {
          const retryKey = `retry:${cleanup.operationId}`;
          const forgetKey = `forget:${cleanup.operationId}`;
          return (
            <div
              key={cleanup.operationId}
              className="flex flex-wrap items-center gap-3 px-3 py-2 text-xs"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium text-foreground">
                    {cleanup.entityName ?? cleanup.entityId}
                  </span>
                  <span className="rounded-full border border-border-warning px-1.5 py-0.5 text-[10px] tracking-wide text-foreground-warning uppercase">
                    {cleanupStatusLabel(cleanup)}
                  </span>
                  <span className="text-foreground-muted">
                    {cleanup.hostLabel ?? cleanup.hostRef}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-foreground-muted">
                  {cleanup.workspacePath ?? 'No workspace path'}
                  {cleanup.branchName ? ` · ${cleanup.branchName}` : ''}
                  {` · Requested ${new Date(cleanup.createdAt).toLocaleString()}`}
                </div>
                {cleanup.status === 'failed' && (
                  <div className="mt-0.5 truncate text-foreground-destructive">{cleanup.error}</div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pendingAction !== null}
                  onClick={() => void runAction('retry', cleanup)}
                >
                  {pendingAction === retryKey && <Spinner className="size-3.5" />}
                  Clean up now
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pendingAction !== null}
                  onClick={() => void runAction('forget', cleanup)}
                >
                  {pendingAction === forgetKey && <Spinner className="size-3.5" />}
                  Forget
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

const WorkspacesHeader = observer(function WorkspacesHeader({
  store,
  view,
}: {
  store: ProjectWorkspacesStore;
  view: ProjectWorkspacesListView;
}) {
  const search = view.useSearch();
  const filter = view.useFilter();
  const loading = store.status === 'loading' || store.measuring;

  return (
    <PageHeader
      title="Workspaces"
      description="Review repository workspaces, linked tasks, and reclaimable artifacts."
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchInput
          containerClassName="min-w-64 flex-1"
          className="h-8"
          placeholder="Search workspaces, branches, tasks..."
          value={search.query}
          onChange={(event) => search.setQuery(event.target.value)}
        />
        <div className="flex items-center gap-3">
          {(['all', 'used', 'unused'] as const).map((usage) => (
            <ListView.FilterButton
              key={usage}
              active={filter.model.usage === usage}
              onClick={() => filter.set({ usage })}
            >
              {usage[0]!.toUpperCase() + usage.slice(1)}
            </ListView.FilterButton>
          ))}
          <Button variant="outline" size="sm" disabled={loading} onClick={() => void store.load()}>
            <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>
    </PageHeader>
  );
});

const WorkspaceRow = observer(function WorkspaceRow({
  view,
  row,
}: {
  view: ProjectWorkspacesListView;
  row: ProjectWorkspaceRow;
}) {
  const selection = view.useSelection();
  const selectable = row.canCleanArtifacts || row.canDelete;
  const selected = selection.isSelected(row.path);
  const name = row.kind === 'root' ? 'Repository root' : row.branch || basename(row.path);
  const disabledReason = selectable ? undefined : unselectableReason(row);

  return (
    <ListView.Row
      bare
      interactive={selectable}
      selected={false}
      className={cn(
        selectable && !selected && 'hover:bg-background-1',
        selected && 'bg-background-2 hover:bg-background-2'
      )}
      onClick={(event) => {
        if (selectable) selection.toggle(row.path, event);
      }}
    >
      <div className="grid min-h-[72px] grid-cols-[28px_minmax(0,1fr)_130px_118px] items-center gap-3 px-3 py-2 text-sm">
        <SelectableCheckbox
          checked={selected}
          disabled={!selectable}
          label={`Select ${name}`}
          disabledReason={disabledReason}
          onToggle={() => selection.toggle(row.path)}
        />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-foreground">{name}</span>
            <WorkspaceBadges row={row} />
          </div>
          <div className="truncate text-xs text-foreground-muted">{row.path}</div>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-foreground-muted">
            <span>{taskCount(row.tasks.length)}</span>
            {row.tasks.length > 0 && (
              <Tooltip>
                <TooltipTrigger className="truncate text-left underline decoration-dotted underline-offset-2">
                  {row.tasks.map((task) => task.name).join(', ')}
                </TooltipTrigger>
                <TooltipContent className="max-w-[280px] text-xs">
                  {row.tasks.map((task) => task.name).join(', ')}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
        <WorkspaceUsageCell row={row} />
        <div className="text-right text-xs text-foreground-muted tabular-nums">
          {formatActivityDate(row.lastActivityAt)}
        </div>
      </div>
    </ListView.Row>
  );
});

function SelectableCheckbox({
  checked,
  disabled,
  label,
  disabledReason,
  onToggle,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  disabledReason?: string;
  onToggle: () => void;
}) {
  const checkbox = (
    <Checkbox
      checked={checked}
      disabled={disabled}
      aria-label={label}
      onClick={(event) => event.stopPropagation()}
      onCheckedChange={onToggle}
    />
  );
  if (!disabled || !disabledReason) return checkbox;
  return (
    <Tooltip>
      <TooltipTrigger>
        <span
          className="inline-flex size-4 items-center justify-center"
          onClick={(event) => event.stopPropagation()}
        >
          {checkbox}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[220px] text-xs">{disabledReason}</TooltipContent>
    </Tooltip>
  );
}

function WorkspaceUsageCell({ row }: { row: ProjectWorkspaceRow }) {
  if (
    !row.usage &&
    row.pathState !== 'error' &&
    row.pathState !== 'missing' &&
    row.pathState !== 'remote'
  ) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="h-3.5 w-16 animate-pulse rounded bg-background-2" />
        <div className="h-3 w-24 animate-pulse rounded bg-background-2" />
      </div>
    );
  }
  if (!row.usage) {
    return (
      <div className="text-right text-xs text-foreground-muted">
        {row.pathState === 'error' ? 'Scan failed' : pathStateLabel(row.pathState)}
      </div>
    );
  }
  return (
    <div className="text-right tabular-nums">
      <div className="text-foreground">{formatBytes(row.usage.totalBytes)}</div>
      <div className="text-xs text-foreground-muted">
        {formatBytes(row.usage.artifactBytes)} artifacts
      </div>
    </div>
  );
}

const WorkspacesSelectionBar = observer(function WorkspacesSelectionBar({
  store,
  view,
  projectId,
}: {
  store: ProjectWorkspacesStore;
  view: ProjectWorkspacesListView;
  projectId: string;
}) {
  const showConfirm = useShowModal('confirmActionModal');
  const list = view.useListView();
  const selection = view.useSelection();
  const [pendingAction, setPendingAction] = useState<'archive' | 'delete' | null>(null);
  const selectedRows = list.visibleItems.filter((row) => selection.selectedIds.has(row.path));
  const archivableRows = selectedRows.filter((row) => row.canCleanArtifacts);
  const deletableRows = selectedRows.filter((row) => row.canDelete);
  const selectedArtifactBytes = archivableRows.reduce(
    (sum, row) => sum + (row.usage?.artifactBytes ?? 0),
    0
  );
  const selectedTotalBytes = deletableRows.reduce(
    (sum, row) => sum + (row.usage?.totalBytes ?? 0),
    0
  );
  const activeSelected = selectedRows.some((row) => row.hasActiveSessions);

  const runAction = useCallback(
    async (kind: 'archive' | 'delete', rows: ProjectWorkspaceRow[]) => {
      if (rows.length === 0) return;
      const paths = rows.map((row) => row.path);
      setPendingAction(kind);
      try {
        const result =
          kind === 'archive'
            ? await archiveProjectWorkspaces(projectId, rows)
            : await rpc.projectWorkspaces.deleteProjectWorkspaces({ projectId, paths });
        showActionResult(kind, result);
        if (result.failedCount === 0) selection.clear();
        await store.load();
      } catch (error) {
        toast({
          title:
            kind === 'archive' ? 'Could not archive workspaces' : 'Could not delete workspaces',
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        });
      } finally {
        setPendingAction(null);
      }
    },
    [projectId, selection, store]
  );

  const confirmArchive = useCallback(() => {
    if (archivableRows.length === 0) return;
    showConfirm({
      title: `Archive ${workspaceCount(archivableRows.length)}?`,
      description: activeSelected
        ? 'This stops active sessions, runs teardown scripts, and removes gitignored artifacts. Tasks remain restorable, but dependencies may need to be restored.'
        : 'This runs teardown scripts and removes gitignored dependencies, build output, and caches. Worktrees and tasks stay intact.',
      confirmLabel: 'Archive',
      onSuccess: () => {
        void runAction('archive', archivableRows);
      },
    });
  }, [activeSelected, archivableRows, runAction, showConfirm]);

  const confirmDelete = useCallback(() => {
    if (deletableRows.length === 0) return;
    showConfirm({
      title: `Delete ${workspaceCount(deletableRows.length)}?`,
      description: activeSelected
        ? 'This removes selected workspaces and linked tasks. Some selected workspaces have active sessions, which will be stopped.'
        : 'This removes selected workspaces. Linked tasks are deleted with their owned worktrees.',
      confirmLabel: 'Delete',
      variant: 'destructive',
      onSuccess: () => {
        void runAction('delete', deletableRows);
      },
    });
  }, [activeSelected, deletableRows, runAction, showConfirm]);

  if (selection.count === 0) return null;

  return (
    <ListPopoverCard className="justify-between">
      <div className="flex min-w-0 items-center gap-4 text-xs text-foreground-muted">
        <span className="whitespace-nowrap">{selection.count} selected</span>
        <span className="inline-flex items-center gap-1">
          <HardDrive className="size-3.5" />
          {formatBytes(selectedArtifactBytes)} artifacts to archive
        </span>
        <span>{formatBytes(selectedTotalBytes)} delete total</span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={archivableRows.length === 0 || pendingAction !== null}
          onClick={confirmArchive}
        >
          {pendingAction === 'archive' ? (
            <Spinner className="size-4" />
          ) : (
            <Archive className="size-4" />
          )}
          Archive
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={deletableRows.length === 0 || pendingAction !== null}
          onClick={confirmDelete}
        >
          {pendingAction === 'delete' ? (
            <Spinner className="size-4" />
          ) : (
            <Trash2 className="size-4" />
          )}
          Delete
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => selection.clear()}
          aria-label="Clear selection"
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </ListPopoverCard>
  );
});

function WorkspaceWarnings({ warnings }: { warnings: string[] }) {
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => setDismissed(false), [warnings]);
  if (dismissed || warnings.length === 0) return null;
  return (
    <div className="mt-4 flex items-start gap-2 rounded-md border border-border-warning bg-background-warning px-3 py-2 text-xs text-foreground-warning">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">Workspace scan completed with warnings</div>
        <div className="truncate text-foreground-warning/80">{warnings.join(' ')}</div>
      </div>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss warning"
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

function WorkspacesLoadingState() {
  return (
    <div className="flex h-40 items-center justify-center gap-2 text-sm text-foreground-muted">
      <Spinner className="size-4" />
      Loading workspaces
    </div>
  );
}

function WorkspacesErrorState({ message }: { message: string | null }) {
  return (
    <div className="flex h-40 flex-col items-center justify-center gap-1 text-sm">
      <div className="text-foreground-destructive">Could not load workspaces.</div>
      {message && (
        <div className="max-w-md text-center text-xs text-foreground-muted">{message}</div>
      )}
    </div>
  );
}

function WorkspaceBadges({ row }: { row: ProjectWorkspaceRow }) {
  const badges = [
    row.kind === 'candidate' ? 'Candidate' : null,
    row.hasActiveSessions ? 'Active' : null,
    row.pathState !== 'measured' ? pathStateLabel(row.pathState) : null,
  ].filter((badge): badge is string => !!badge);
  if (badges.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1">
      {badges.map((badge) => (
        <span
          key={badge}
          className="rounded-full border border-border/70 px-1.5 py-0.5 text-[10px] tracking-wide text-foreground-muted uppercase"
        >
          {badge}
        </span>
      ))}
    </span>
  );
}

async function archiveProjectWorkspaces(
  projectId: string,
  rows: ProjectWorkspaceRow[]
): Promise<ProjectWorkspaceActionSummary> {
  const client = await getWorkspacesWireClient();
  const results: ProjectWorkspaceActionResult[] = [];
  for (const row of rows) {
    try {
      const result = await client.archive({
        projectId,
        workspaceId: row.workspaceId ?? undefined,
        workspacePath: row.path,
        branchName: row.branch,
      });
      results.push(
        result.success
          ? {
              path: row.path,
              workspaceId: row.workspaceId ?? undefined,
              success: true,
              reclaimedBytes: row.usage?.artifactBytes,
            }
          : {
              path: row.path,
              workspaceId: row.workspaceId ?? undefined,
              success: false,
              reason: 'archive-failed',
              message: result.error.message,
            }
      );
    } catch (error) {
      results.push({
        path: row.path,
        workspaceId: row.workspaceId ?? undefined,
        success: false,
        reason: 'archive-failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const succeededCount = results.filter((result) => result.success).length;
  return {
    succeededCount,
    failedCount: results.length - succeededCount,
    results,
  };
}

function showActionResult(kind: 'archive' | 'delete', result: ProjectWorkspaceActionSummary): void {
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
      kind === 'archive'
        ? `Queued archive for ${workspaceCount(result.succeededCount)}`
        : `Deleted ${workspaceCount(result.succeededCount)}`,
  });
}

function unselectableReason(row: ProjectWorkspaceRow): string {
  if (row.kind === 'root' && !row.canCleanArtifacts) return 'Repository root cannot be deleted.';
  if (row.pathState === 'remote') return 'Remote workspaces are not supported here yet.';
  if (row.pathState === 'missing') return 'Workspace path is missing.';
  if (row.pathState === 'error') return 'Workspace usage scan failed.';
  return 'This workspace does not support cleanup or deletion.';
}

function pathStateLabel(state: ProjectWorkspacePathState): string {
  switch (state) {
    case 'measured':
      return 'Ready';
    case 'missing':
      return 'Missing';
    case 'not-worktree':
      return 'No worktree';
    case 'remote':
      return 'Remote';
    case 'no-path':
      return 'No path';
    case 'error':
      return 'Scan error';
  }
}

function cleanupStatusLabel(cleanup: DeletionState): string {
  switch (cleanup.status) {
    case 'blocked-host-offline':
      return 'Host offline';
    case 'awaiting-confirmation':
      return cleanup.confirmationReason === 'workspace-modified'
        ? 'Workspace modified'
        : 'Needs review';
    case 'failed':
      return 'Failed';
    case 'cleaning':
      return 'Cleaning';
  }
}

function usageErrorMessage(error: unknown): string {
  return `Could not measure workspace usage: ${error instanceof Error ? error.message : String(error)}`;
}

function formatActivityDate(value?: string): string {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  const now = new Date();
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

function taskCount(count: number): string {
  return `${count} ${count === 1 ? 'task' : 'tasks'}`;
}

function workspaceCount(count: number): string {
  return `${count} ${count === 1 ? 'workspace' : 'workspaces'}`;
}

function basename(filePath: string): string {
  return filePath.split(/[\\/]/u).filter(Boolean).at(-1) ?? filePath;
}
