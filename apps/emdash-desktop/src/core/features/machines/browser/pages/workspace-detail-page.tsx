import type { OperationDisplayState } from '@emdash/core/primitives/operations/api';
import {
  ColumnList,
  ColumnListCell,
  WorkspaceIcon,
  type ColumnListColumn,
  type WorkspaceIconStatus,
  type WorkspaceIconType,
} from '@emdash/ui/react/components';
import { useQueryClient } from '@tanstack/react-query';
import { WifiOffIcon } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useMemo, type ReactNode } from 'react';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import type { SettingsPageDetailProps } from '@core/primitives/settings/api/page-contribution';
import { Spinner } from '@core/primitives/ui/browser/spinner';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@core/primitives/ui/browser/tooltip';
import { toast } from '@core/primitives/ui/browser/use-toast';
import type {
  ProjectWorkspaceGitStats,
  ProjectWorkspacePathIssue,
  ProjectWorkspaceRow,
  ProjectWorkspaceUsage,
} from '@core/primitives/workspaces/api';
import {
  OperationTreesPanel,
  relativeQueuedTime,
} from '@core/services/operations/browser/operation-trees-panel';
import { GitStatsCell } from '../components/git-stats-cell';
import { RepositoryHeader } from '../components/local-workspace-header';
import { basename, formatBytes } from '../components/workspace-format';
import { deleteMachineProjectWorkspaces } from '../use-machine-workspaces';
import { useWorkspaceRows, type WorkspacesScope } from '../use-workspace-rows';
import type { JoinedWorkspaceRow, WorkspaceOperationLink } from '../workspace-rows';
import { aggregateWorkspaceStatus } from '../workspace-runtime-status';

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
  operation?: WorkspaceOperationLink;
  pathIssue?: ProjectWorkspacePathIssue;
};

const DETAIL_COLUMNS: ColumnListColumn<WorkspaceDetailListItem>[] = [
  {
    id: 'icon',
    width: '2.25rem',
    cell: (item) => <WorkspaceIcon type={item.iconType} status={item.status} />,
  },
  {
    id: 'name',
    width: 'minmax(0, 1fr)',
    cell: (item) => (
      <ColumnListCell
        primary={
          <span className="inline-flex min-w-0 items-center gap-2">
            <span className="truncate">{item.name}</span>
            {item.pathIssue && <PathIssueChip issue={item.pathIssue} path={item.path} />}
            {item.operation && <OperationChip operation={item.operation} />}
          </span>
        }
        secondary={item.path}
      />
    ),
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

/** Local Workspaces tab detail: path is `[projectId]`. */
export function LocalWorkspaceDetailPage(props: SettingsPageDetailProps) {
  return <WorkspaceDetailPage scope={{ kind: 'local' }} connected {...props} />;
}

/**
 * Scope-aware project workspace detail. The machine-scoped wrapper lives in
 * machine-details-page.tsx, which owns the connection-state lookup.
 */
export const WorkspaceDetailPage = observer(function WorkspaceDetailPage({
  scope,
  connected,
  machineName,
  detailId,
  closeDetail,
}: {
  scope: WorkspacesScope;
  connected: boolean;
  machineName?: string;
} & SettingsPageDetailProps) {
  const queryClient = useQueryClient();
  const openConfirm = useOpenModal('confirmActionModal');
  const isLocal = scope.kind === 'local';
  const workspaceRows = useWorkspaceRows({ scope, projectId: detailId, enabled: connected });
  const { workspaceQuery, group, rows, operationTrees, usageQuery, gitStatsQuery } = workspaceRows;
  const rowStatuses = rows.map((row) => row.status);
  const aggregateStatus = aggregateWorkspaceStatus(rowStatuses) satisfies WorkspaceIconStatus;
  const rootJoined = rows.find((joined) => joined.row.kind === 'root') ?? rows[0];
  const rootRow = rootJoined?.row;
  const busyPaths = useMemo(
    () => new Set(rows.filter((row) => row.operationBusy).map((row) => row.row.path)),
    [rows]
  );
  const worktreeItems = rows
    .filter((row) => row !== rootJoined)
    .map((joined) =>
      buildWorktreeItem({
        joined,
        loadingUsage: usageQuery.isLoading || usageQuery.isFetching,
        loadingGitStats: gitStatsQuery.isLoading || gitStatsQuery.isFetching,
      })
    );

  const handleDelete = useCallback(async () => {
    if (!group) return;
    const allDeletableRows = group.workspaces.filter((row) => row.row.canDelete);
    const deletableRows = allDeletableRows.filter((row) => !busyPaths.has(row.row.path));
    if (deletableRows.length === 0) {
      const blockedByOperations = allDeletableRows.length > 0;
      toast({
        title: blockedByOperations ? 'Cleanup already in progress' : 'No deletable workspaces',
        description: blockedByOperations
          ? 'Cleanup already in progress for these workspaces.'
          : 'Repository roots cannot be deleted from this view.',
      });
      return;
    }

    const outcome = await openConfirm({
      title: `Delete ${group.project.name} workspaces?`,
      description:
        'This deletes linked task worktrees for this repository where supported. Repository roots are preserved.',
      confirmLabel: 'Delete',
      variant: 'destructive',
      // Unchecked default (spec §7.1): removal keeps conversation records.
      checkbox: { label: 'Delete their conversations too' },
    });

    if (!outcome.success) return;

    try {
      const result = await deleteMachineProjectWorkspaces({
        projectId: group.project.id,
        paths: deletableRows.map((row) => row.row.path),
        deleteConversations: outcome.data?.checked ?? false,
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

      await queryClient.invalidateQueries({
        queryKey: ['machineWorkspaces', isLocal ? 'local' : scope.machineId],
      });
    } catch (error) {
      toast({
        title: 'Could not delete workspaces',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  }, [busyPaths, closeDetail, group, isLocal, openConfirm, queryClient, scope]);

  if (!connected) return <DetailOfflineState machineName={machineName} />;
  if (workspaceQuery.isLoading) return <DetailLoadingState />;
  if (workspaceQuery.isError) return <DetailErrorState error={workspaceQuery.error} />;
  if (!group || !rootJoined || !rootRow) return <DetailMissingState />;

  return (
    <TooltipProvider delay={150}>
      <div className="flex min-h-0 flex-col gap-6 pb-4">
        <RepositoryHeader
          project={group.project}
          rootRow={rootRow}
          rows={rows.map((joined) => joined.row)}
          status={aggregateStatus}
          usage={rootJoined.usage}
          gitStats={rootJoined.gitStats}
          loadingUsage={
            (usageQuery.isLoading || usageQuery.isFetching) && rootRow.pathState === 'measured'
          }
          loadingGitStats={
            (gitStatsQuery.isLoading || gitStatsQuery.isFetching) &&
            rootRow.pathState === 'measured'
          }
          operationTrees={operationTrees.trees}
          warnings={group.warnings}
          onDelete={() => void handleDelete()}
        />

        {operationTrees.trees.length > 0 && (
          <OperationTreesPanel {...operationTrees} className="mx-0" />
        )}

        <WorkspaceSection label="Worktrees">
          <ColumnList
            items={worktreeItems}
            columns={DETAIL_COLUMNS}
            getItemKey={(item) => item.id}
            emptySlot={<WorktreesEmptyState />}
          />
        </WorkspaceSection>
      </div>
    </TooltipProvider>
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

function buildWorktreeItem({
  joined,
  loadingUsage,
  loadingGitStats,
}: {
  joined: JoinedWorkspaceRow;
  loadingUsage: boolean;
  loadingGitStats: boolean;
}): WorkspaceDetailListItem {
  const { row } = joined;
  return {
    id: joined.key,
    name: row.branch ?? basename(row.path),
    path: row.path,
    iconType: 'worktree',
    status: joined.status satisfies WorkspaceIconStatus,
    branch: row.branch,
    gitStats: joined.gitStats,
    usage: joined.usage,
    linkedTaskCount: row.tasks.length,
    activeTaskCount: activeTaskCount(row),
    loadingUsage: loadingUsage && row.pathState === 'measured',
    loadingGitStats: loadingGitStats && row.pathState === 'measured',
    operation: joined.operation,
    ...(row.pathIssue ? { pathIssue: row.pathIssue } : {}),
  };
}

function PathIssueChip({ issue, path }: { issue: ProjectWorkspacePathIssue; path: string }) {
  return (
    <Tooltip>
      <TooltipTrigger>
        <span className={pathIssueChipClass(issue)}>
          {issue.kind === 'prunable' ? 'Stale git record' : 'Missing'}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-80 text-xs">{pathIssueMessage(issue, path)}</TooltipContent>
    </Tooltip>
  );
}

function pathIssueChipClass(issue: ProjectWorkspacePathIssue): string {
  const base = 'shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] tracking-wide uppercase';
  if (issue.kind === 'prunable') return `${base} border-border-warning text-foreground-warning`;
  return `${base} border-border-destructive text-foreground-destructive`;
}

function pathIssueMessage(issue: ProjectWorkspacePathIssue, path: string): string {
  if (issue.reason) return issue.reason;
  if (issue.kind === 'prunable') return 'Git reports this worktree as prunable.';
  return `Directory not found at ${path}.`;
}

function OperationChip({ operation }: { operation: WorkspaceOperationLink }) {
  return (
    <Tooltip>
      <TooltipTrigger>
        <span className={operationChipClass(operation.node)}>
          {operationChipLabel(operation.node)}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-70 text-xs">{operationTooltip(operation)}</TooltipContent>
    </Tooltip>
  );
}

function operationChipLabel(operation: OperationDisplayState): string {
  switch (operation.status) {
    case 'queued':
      return 'Queued';
    case 'running':
      return 'In progress';
    case 'waiting':
    case 'waiting-children':
      return 'Waiting';
    case 'succeeded':
      return 'Done';
    case 'blocked-host-offline':
    case 'awaiting-confirmation':
    case 'failed':
      return 'Needs attention';
  }
}

function operationChipClass(operation: OperationDisplayState): string {
  const base = 'shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] tracking-wide uppercase';
  switch (operation.status) {
    case 'running':
      return `${base} animate-pulse border-border-warning text-foreground-warning`;
    case 'queued':
      return `${base} border-border text-foreground-muted`;
    case 'waiting':
    case 'waiting-children':
    case 'succeeded':
      return `${base} border-border text-foreground-muted`;
    case 'blocked-host-offline':
    case 'awaiting-confirmation':
      return `${base} border-border-warning text-foreground-warning`;
    case 'failed':
      return `${base} border-border-destructive text-foreground-destructive`;
  }
}

function operationTooltip(operation: WorkspaceOperationLink): string {
  const rootName = operation.root.entityName ?? operation.root.entityId;
  return `Part of ${operation.root.displayName} "${rootName}", ${relativeQueuedTime(
    operation.root.createdAt
  )}`;
}

function activeTaskCount(row: ProjectWorkspaceRow): number {
  return row.tasks.filter((task) => task.status === 'in_progress' || task.status === 'review')
    .length;
}

function formatCount(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function DetailOfflineState({ machineName }: { machineName?: string }) {
  return (
    <div className="flex h-40 flex-col items-center justify-center gap-1 text-sm text-foreground-muted">
      <div className="inline-flex items-center gap-2">
        <WifiOffIcon className="size-4" />
        {machineName ? `${machineName} is offline` : 'Machine offline'}
      </div>
      <p className="max-w-sm text-center text-xs text-foreground-passive">
        Workspaces load here as soon as the machine reconnects.
      </p>
    </div>
  );
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
