import {
  ColumnList,
  ColumnListCell,
  WorkspaceIcon,
  type ColumnListColumn,
  type WorkspaceIconStatus,
  type WorkspaceIconType,
} from '@emdash/ui/react/components';
import { Button, DropdownMenu } from '@emdash/ui/react/primitives';
import { useQueryClient } from '@tanstack/react-query';
import { EllipsisIcon, Trash2Icon } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useMemo, type ReactNode } from 'react';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import type { SettingsPageDetailProps } from '@core/primitives/settings/api/page-contribution';
import { Spinner } from '@core/primitives/ui/browser/spinner';
import { toast } from '@core/primitives/ui/browser/use-toast';
import type {
  ProjectWorkspaceGitStats,
  ProjectWorkspaceRow,
  ProjectWorkspaceUsage,
} from '@core/primitives/workspaces/api';
import {
  deleteMachineProjectWorkspaces,
  useProjectWorkspaceGitStats,
  useProjectWorkspaceUsage,
  useLocalWorkspaces,
  type MachineProjectWorkspaces,
} from '../use-machine-workspaces';
import { useWorkspaceRuntimeStatuses } from '../use-workspace-runtime-statuses';
import { aggregateWorkspaceStatus, workspaceStatus } from '../workspace-runtime-status';

type WorkspaceDetailListItem = {
  id: string;
  name: string;
  path: string;
  iconType: WorkspaceIconType;
  status: WorkspaceIconStatus;
  branch?: string;
  gitStats?: ProjectWorkspaceGitStats;
  usage?: ProjectWorkspaceUsage;
  linkedTaskCount: number;
  activeTaskCount: number;
  loadingGitStats: boolean;
  loadingUsage: boolean;
};

const EMPTY_WORKSPACE_GROUPS: MachineProjectWorkspaces[] = [];

const DETAIL_COLUMNS: ColumnListColumn<WorkspaceDetailListItem>[] = [
  {
    id: 'icon',
    width: '2.25rem',
    cell: (item) => <WorkspaceIcon type={item.iconType} status={item.status} />,
  },
  {
    id: 'name',
    width: 'minmax(0, 1fr)',
    cell: (item) => <ColumnListCell primary={item.name} secondary={item.path} />,
  },
  {
    id: 'git',
    width: '13rem',
    cell: (item) => (
      <ColumnListCell
        primary={item.branch ?? 'No branch'}
        secondary={<GitStatsCell stats={item.gitStats} loading={item.loadingGitStats} />}
      />
    ),
  },
  {
    id: 'storage',
    width: '9rem',
    cell: (item) => (
      <ColumnListCell
        primary={
          item.usage ? formatBytes(item.usage.totalBytes) : item.loadingUsage ? 'Loading...' : '-'
        }
        secondary={
          item.usage
            ? `${formatBytes(item.usage.artifactBytes)} artifacts`
            : item.loadingUsage
              ? 'Scanning artifacts'
              : '-'
        }
      />
    ),
  },
  {
    id: 'tasks',
    width: '10rem',
    cell: (item) => (
      <ColumnListCell
        primary={formatCount(item.linkedTaskCount, 'Linked task')}
        secondary={formatCount(item.activeTaskCount, 'task active', 'tasks active')}
      />
    ),
  },
];

export const LocalWorkspaceDetailPage = observer(function LocalWorkspaceDetailPage({
  detailId,
  closeDetail,
}: SettingsPageDetailProps) {
  const queryClient = useQueryClient();
  const openConfirm = useOpenModal('confirmActionModal');
  const workspaceQuery = useLocalWorkspaces(true);
  const groups = workspaceQuery.data ?? EMPTY_WORKSPACE_GROUPS;
  const group = groups.find((candidate) => candidate.project.id === detailId);
  const rows = useMemo(() => group?.workspaces ?? [], [group]);
  const measuredPaths = useMemo(
    () => rows.filter((row) => row.pathState === 'measured').map((row) => row.path),
    [rows]
  );
  const statusInputs = useMemo(
    () =>
      rows.map((row) => ({
        workspaceId: row.workspaceId,
        hasActiveSessions: row.hasActiveSessions,
      })),
    [rows]
  );
  const statuses = useWorkspaceRuntimeStatuses(statusInputs);
  const usageQuery = useProjectWorkspaceUsage(detailId, measuredPaths, rows.length > 0);
  const gitStatsQuery = useProjectWorkspaceGitStats(detailId, measuredPaths, rows.length > 0);
  const usageByPath = useMemo(() => usageResultsToMap(usageQuery.data?.results), [usageQuery.data]);
  const gitStatsByPath = useMemo(
    () => gitStatsResultsToMap(gitStatsQuery.data?.results),
    [gitStatsQuery.data]
  );
  const rowStatuses = rows.map((row) => workspaceStatus(row, statuses));
  const rootRow = rows.find((row) => row.kind === 'root') ?? rows[0];
  const repositoryItem =
    group && rootRow
      ? buildRepositoryItem({
          group,
          rootRow,
          rows,
          status: aggregateWorkspaceStatus(rowStatuses) satisfies WorkspaceIconStatus,
          usageByPath,
          gitStatsByPath,
          loadingUsage: usageQuery.isLoading || usageQuery.isFetching,
          loadingGitStats: gitStatsQuery.isLoading || gitStatsQuery.isFetching,
        })
      : null;
  const worktreeItems = rows
    .filter((row) => row !== rootRow)
    .map((row) =>
      buildWorktreeItem({
        row,
        status: workspaceStatus(row, statuses) satisfies WorkspaceIconStatus,
        usageByPath,
        gitStatsByPath,
        loadingUsage: usageQuery.isLoading || usageQuery.isFetching,
        loadingGitStats: gitStatsQuery.isLoading || gitStatsQuery.isFetching,
      })
    );

  const handleDelete = useCallback(async () => {
    if (!group) return;
    const deletableRows = group.workspaces.filter((row) => row.canDelete);
    if (deletableRows.length === 0) {
      toast({
        title: 'No deletable workspaces',
        description: 'Repository roots cannot be deleted from this view.',
      });
      return;
    }

    const outcome = await openConfirm({
      title: `Delete ${group.project.name} workspaces?`,
      description:
        'This deletes linked task worktrees for this repository where supported. Repository roots are preserved.',
      confirmLabel: 'Delete',
      variant: 'destructive',
    });

    if (!outcome.success) return;

    try {
      const result = await deleteMachineProjectWorkspaces({
        projectId: group.project.id,
        paths: deletableRows.map((row) => row.path),
      });
      const failed = result.results.filter((row) => !row.success);

      if (failed.length > 0) {
        toast({
          title: `${result.results.length - failed.length} deleted, ${failed.length} failed`,
          description: failed[0]?.message,
          variant: 'destructive',
        });
      } else {
        toast({ title: `Deleted ${deletableRows.length} workspaces` });
        closeDetail();
      }

      await queryClient.invalidateQueries({ queryKey: ['machineWorkspaces', 'local'] });
    } catch (error) {
      toast({
        title: 'Could not delete workspaces',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  }, [closeDetail, group, openConfirm, queryClient]);

  if (workspaceQuery.isLoading) return <DetailLoadingState />;
  if (workspaceQuery.isError) return <DetailErrorState error={workspaceQuery.error} />;
  if (!group || !repositoryItem) return <DetailMissingState />;

  return (
    <div className="flex min-h-0 flex-col gap-6 pb-4">
      <div className="flex justify-end">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            <Button type="button" variant="ghost" size="sm" icon aria-label="Workspace actions">
              <EllipsisIcon aria-hidden />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end">
            <DropdownMenu.Item variant="destructive" onClick={() => void handleDelete()}>
              <Trash2Icon aria-hidden />
              Delete
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>

      <WorkspaceSection label="Repository">
        <ColumnList
          items={[repositoryItem]}
          columns={DETAIL_COLUMNS}
          getItemKey={(item) => item.id}
        />
      </WorkspaceSection>

      <WorkspaceSection label="Worktrees">
        <ColumnList
          items={worktreeItems}
          columns={DETAIL_COLUMNS}
          getItemKey={(item) => item.id}
          emptySlot={<WorktreesEmptyState />}
        />
      </WorkspaceSection>
    </div>
  );
});

function WorkspaceSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex min-h-0 flex-col gap-2">
      <div className="px-1 text-xs font-medium tracking-wide text-foreground-muted uppercase">
        {label}
      </div>
      {children}
    </section>
  );
}

function buildRepositoryItem({
  group,
  rootRow,
  rows,
  status,
  usageByPath,
  gitStatsByPath,
  loadingUsage,
  loadingGitStats,
}: {
  group: MachineProjectWorkspaces;
  rootRow: ProjectWorkspaceRow;
  rows: readonly ProjectWorkspaceRow[];
  status: WorkspaceIconStatus;
  usageByPath: Map<string, ProjectWorkspaceUsage>;
  gitStatsByPath: Map<string, ProjectWorkspaceGitStats>;
  loadingUsage: boolean;
  loadingGitStats: boolean;
}): WorkspaceDetailListItem {
  return {
    id: `${group.project.id}:repository`,
    name: group.project.name,
    path: rootRow.path,
    iconType: 'repository',
    status,
    branch: rootRow.branch,
    gitStats: gitStatsByPath.get(rootRow.path),
    usage: usageByPath.get(rootRow.path),
    linkedTaskCount: rows.reduce((count, row) => count + row.tasks.length, 0),
    activeTaskCount: rows.reduce((count, row) => count + activeTaskCount(row), 0),
    loadingUsage: loadingUsage && rootRow.pathState === 'measured',
    loadingGitStats: loadingGitStats && rootRow.pathState === 'measured',
  };
}

function buildWorktreeItem({
  row,
  status,
  usageByPath,
  gitStatsByPath,
  loadingUsage,
  loadingGitStats,
}: {
  row: ProjectWorkspaceRow;
  status: WorkspaceIconStatus;
  usageByPath: Map<string, ProjectWorkspaceUsage>;
  gitStatsByPath: Map<string, ProjectWorkspaceGitStats>;
  loadingUsage: boolean;
  loadingGitStats: boolean;
}): WorkspaceDetailListItem {
  return {
    id: row.workspaceId ?? row.path,
    name: row.branch ?? basename(row.path),
    path: row.path,
    iconType: 'worktree',
    status,
    branch: row.branch,
    gitStats: gitStatsByPath.get(row.path),
    usage: usageByPath.get(row.path),
    linkedTaskCount: row.tasks.length,
    activeTaskCount: activeTaskCount(row),
    loadingUsage: loadingUsage && row.pathState === 'measured',
    loadingGitStats: loadingGitStats && row.pathState === 'measured',
  };
}

function GitStatsCell({
  stats,
  loading,
}: {
  stats: ProjectWorkspaceGitStats | undefined;
  loading: boolean;
}) {
  if (stats) {
    return (
      <span className="inline-flex gap-1">
        <span className="text-foreground-diff-added">+{stats.added}</span>
        <span className="text-foreground-diff-deleted">-{stats.removed}</span>
        <span>↑{stats.ahead}</span>
        <span>↓{stats.behind}</span>
      </span>
    );
  }
  return loading ? 'Loading...' : '-';
}

function usageResultsToMap(
  results:
    | Array<
        | { path: string; success: true; usage: ProjectWorkspaceUsage }
        | { path: string; success: false; message: string }
      >
    | undefined
) {
  const usageByPath = new Map<string, ProjectWorkspaceUsage>();
  for (const result of results ?? []) {
    if (result.success) usageByPath.set(result.path, result.usage);
  }
  return usageByPath;
}

function gitStatsResultsToMap(
  results:
    | Array<
        | { path: string; success: true; stats: ProjectWorkspaceGitStats }
        | { path: string; success: false; message: string }
      >
    | undefined
) {
  const statsByPath = new Map<string, ProjectWorkspaceGitStats>();
  for (const result of results ?? []) {
    if (result.success) statsByPath.set(result.path, result.stats);
  }
  return statsByPath;
}

function activeTaskCount(row: ProjectWorkspaceRow): number {
  return row.tasks.filter((task) => task.status === 'in_progress' || task.status === 'review')
    .length;
}

function basename(value: string): string {
  const normalized = value.replace(/\\/gu, '/').replace(/\/+$/u, '');
  return normalized.split('/').at(-1) ?? value;
}

function formatCount(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(1)} ${units[index]}`;
}

function DetailLoadingState() {
  return (
    <div className="flex h-40 items-center justify-center gap-2 text-sm text-foreground-muted">
      <Spinner className="size-4" />
      Loading workspace
    </div>
  );
}

function DetailErrorState({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex h-40 flex-col items-center justify-center gap-1 text-sm">
      <div className="text-foreground-destructive">Could not load workspace.</div>
      <div className="max-w-md text-center text-xs text-foreground-muted">{message}</div>
    </div>
  );
}

function DetailMissingState() {
  return (
    <div className="flex h-40 items-center justify-center text-sm text-foreground-muted">
      Workspace not found.
    </div>
  );
}

function WorktreesEmptyState() {
  return (
    <div className="flex h-32 items-center justify-center text-sm text-foreground-muted">
      No worktrees found.
    </div>
  );
}
