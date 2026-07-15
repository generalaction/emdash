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
import { HardDrive, RefreshCw, Trash2, WandSparkles } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useMemo, useState } from 'react';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import { SearchInput } from '@renderer/lib/ui/search-input';
import { Spinner } from '@renderer/lib/ui/spinner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { formatBytes } from '@renderer/utils/formatBytes';
import { cn } from '@renderer/utils/utils';
import type {
  ProjectWorkspaceActionSummary,
  ProjectWorkspacePathState,
  ProjectWorkspaceRow,
} from '@shared/core/workspaces/project-workspaces';

type UsageFilter = 'all' | 'used' | 'unused';

function createProjectWorkspacesListView(projectId: string) {
  const matcher = createTextMatcher<ProjectWorkspaceRow>((row) => [
    row.path,
    row.branch ?? '',
    ...row.tasks.map((task) => task.name),
  ]);

  return createListView({
    getItemId: (row: ProjectWorkspaceRow) => row.path,
    source: {
      kind: 'async',
      load: async () => (await rpc.projectWorkspaces.listProjectWorkspaces(projectId)).rows,
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
          compare: (left, right) => compareNumbers(left.totalBytes, right.totalBytes),
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

export function WorkspacesView({ projectId }: { projectId: string }) {
  const [reloadKey, setReloadKey] = useState(0);
  const view = useMemo(() => createProjectWorkspacesListView(projectId), [projectId]);

  return (
    <TooltipProvider delay={150}>
      <view.Root key={reloadKey}>
        <div className="flex h-full min-h-0 flex-col gap-4 pb-10">
          <WorkspacesToolbar view={view} onRefresh={() => setReloadKey((key) => key + 1)} />
          <ListView.Body className="min-h-0 flex-1 rounded-lg border border-border/70">
            <view.List
              virtualization={{ estimateSize: 72, overscan: 8 }}
              emptySlot={
                <div className="flex h-40 items-center justify-center text-sm text-foreground-muted">
                  No workspaces match the current filters.
                </div>
              }
              loadingSlot={
                <div className="flex h-40 items-center justify-center gap-2 text-sm text-foreground-muted">
                  <Spinner className="size-4" />
                  Scanning workspaces
                </div>
              }
              errorSlot={
                <div className="flex h-40 items-center justify-center text-sm text-foreground-destructive">
                  Could not load workspaces.
                </div>
              }
              renderItem={(row) => <WorkspaceRow view={view} row={row} />}
            />
          </ListView.Body>
          <WorkspacesFooter
            view={view}
            projectId={projectId}
            onRefresh={() => setReloadKey((key) => key + 1)}
          />
        </div>
      </view.Root>
    </TooltipProvider>
  );
}

const WorkspacesToolbar = observer(function WorkspacesToolbar({
  view,
  onRefresh,
}: {
  view: ProjectWorkspacesListView;
  onRefresh: () => void;
}) {
  const search = view.useSearch();
  const filter = view.useFilter();
  const list = view.useListView();

  return (
    <ListView.Toolbar className="flex flex-wrap items-center justify-between gap-3">
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
        <Button variant="outline" size="sm" disabled={list.status === 'loading'} onClick={onRefresh}>
          <RefreshCw className={cn('size-4', list.status === 'loading' && 'animate-spin')} />
          Refresh
        </Button>
      </div>
    </ListView.Toolbar>
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

  return (
    <ListView.Row
      bare
      interactive={selectable}
      selected={selected}
      onClick={(event) => {
        if (selectable) selection.toggle(row.path, event);
      }}
    >
      <div className="grid min-h-[72px] grid-cols-[28px_minmax(0,1fr)_130px_118px] items-center gap-3 px-3 py-2 text-sm">
        <Checkbox
          checked={selected}
          disabled={!selectable}
          aria-label={`Select ${name}`}
          onClick={(event) => event.stopPropagation()}
          onCheckedChange={() => selection.toggle(row.path)}
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
        <div className="text-right tabular-nums">
          <div className="text-foreground">{formatBytes(row.totalBytes)}</div>
          <div className="text-xs text-foreground-muted">{formatBytes(row.artifactBytes)} artifacts</div>
        </div>
        <div className="text-right text-xs text-foreground-muted tabular-nums">
          {formatActivityDate(row.lastActivityAt)}
        </div>
      </div>
    </ListView.Row>
  );
});

const WorkspacesFooter = observer(function WorkspacesFooter({
  view,
  projectId,
  onRefresh,
}: {
  view: ProjectWorkspacesListView;
  projectId: string;
  onRefresh: () => void;
}) {
  const showConfirm = useShowModal('confirmActionModal');
  const list = view.useListView();
  const selection = view.useSelection();
  const [pendingAction, setPendingAction] = useState<'clean' | 'delete' | null>(null);
  const selectedRows = list.visibleItems.filter((row) => selection.selectedIds.has(row.path));
  const cleanableRows = selectedRows.filter((row) => row.canCleanArtifacts);
  const deletableRows = selectedRows.filter((row) => row.canDelete);
  const selectedArtifactBytes = cleanableRows.reduce((sum, row) => sum + row.artifactBytes, 0);
  const selectedTotalBytes = deletableRows.reduce((sum, row) => sum + row.totalBytes, 0);
  const activeSelected = selectedRows.some((row) => row.hasActiveSessions);

  const runAction = useCallback(
    async (kind: 'clean' | 'delete', rows: ProjectWorkspaceRow[]) => {
      if (rows.length === 0) return;
      const paths = rows.map((row) => row.path);
      setPendingAction(kind);
      try {
        const result =
          kind === 'clean'
            ? await rpc.projectWorkspaces.cleanWorkspaceArtifacts({ projectId, paths })
            : await rpc.projectWorkspaces.deleteProjectWorkspaces({ projectId, paths });
        showActionResult(kind, result);
        if (result.failedCount === 0) selection.clear();
        onRefresh();
      } catch (error) {
        toast({
          title: kind === 'clean' ? 'Could not clean artifacts' : 'Could not delete workspaces',
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        });
      } finally {
        setPendingAction(null);
      }
    },
    [onRefresh, projectId, selection]
  );

  const confirmClean = useCallback(() => {
    if (cleanableRows.length === 0) return;
    showConfirm({
      title: `Clean artifacts from ${workspaceCount(cleanableRows.length)}?`,
      description: activeSelected
        ? 'This removes gitignored files from selected workspaces. Some selected workspaces have active sessions, so running tools may need dependencies restored.'
        : 'This removes gitignored files such as dependencies, build output, and caches. The workspaces and tasks stay intact.',
      confirmLabel: 'Clean Artifacts',
      onSuccess: () => {
        void runAction('clean', cleanableRows);
      },
    });
  }, [activeSelected, cleanableRows, runAction, showConfirm]);

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

  return (
    <ListView.Footer className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <div className="flex min-w-0 items-center gap-4 text-xs text-foreground-muted">
        <span>{list.visibleItems.length} shown</span>
        <span>{selection.count} selected</span>
        <span className="inline-flex items-center gap-1">
          <HardDrive className="size-3.5" />
          {formatBytes(selectedArtifactBytes)} artifact cleanup
        </span>
        <span>{formatBytes(selectedTotalBytes)} delete total</span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={cleanableRows.length === 0 || pendingAction !== null}
          onClick={confirmClean}
        >
          {pendingAction === 'clean' ? (
            <Spinner className="size-4" />
          ) : (
            <WandSparkles className="size-4" />
          )}
          Clean Artifacts
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={deletableRows.length === 0 || pendingAction !== null}
          onClick={confirmDelete}
        >
          {pendingAction === 'delete' ? <Spinner className="size-4" /> : <Trash2 className="size-4" />}
          Delete
        </Button>
      </div>
    </ListView.Footer>
  );
});

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
          className="rounded-full border border-border/70 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-foreground-muted"
        >
          {badge}
        </span>
      ))}
    </span>
  );
}

function showActionResult(kind: 'clean' | 'delete', result: ProjectWorkspaceActionSummary): void {
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
        ? `Cleaned ${workspaceCount(result.succeededCount)}`
        : `Deleted ${workspaceCount(result.succeededCount)}`,
  });
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
