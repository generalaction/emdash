import type { OperationDisplayState, OperationTree } from '@emdash/core/primitives/operations/api';
import type { WorkspaceOperationRecord } from '@emdash/core/runtimes/workspace/api';
import {
  ColumnList,
  ColumnListCell,
  WorkspaceIcon,
  type ColumnListColumn,
  type WorkspaceIconStatus,
  type WorkspaceIconType,
} from '@emdash/ui/react/components';
import { useQueryClient } from '@tanstack/react-query';
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
  operationKindLabel,
  operationWorkspacePaths,
  relativeQueuedTime,
} from '@core/services/operations/browser/operation-trees-panel';
import { useOperationTrees } from '@core/services/operations/browser/use-operation-trees';
import { GitStatsCell } from '../components/git-stats-cell';
import { RepositoryHeader } from '../components/local-workspace-header';
import {
  OperationStageChecklist,
  workspaceOperationKindLabel,
} from '../components/operation-stage-checklist';
import { basename, formatBytes } from '../components/workspace-format';
import { WorkspaceOperationsPanel } from '../components/workspace-operations-panel';
import {
  deleteMachineProjectWorkspaces,
  getMachineOperationsClient,
  operationChecklistByPath,
  useProjectWorkspaceGitStats,
  useProjectWorkspaceUsage,
  useLocalWorkspaces,
  useWorkspaceOperationRecords,
  type MachineProjectWorkspaces,
} from '../use-machine-workspaces';
import { useWorkspaceRuntimeStatuses } from '../use-workspace-runtime-statuses';
import {
  aggregateWorkspaceStatus,
  workspacePhase,
  workspacePhaseLabel,
  workspaceRuntimeErrorMessage,
  workspaceStatus,
} from '../workspace-runtime-status';

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
  runtimePhase?: WorkspaceRuntimePhaseDisplay;
  pathIssue?: ProjectWorkspacePathIssue;
  hostOperation?: WorkspaceOperationRecord;
};

type WorkspaceOperationLink = {
  node: OperationDisplayState;
  root: OperationDisplayState;
};

type WorkspaceRuntimePhaseDisplay = {
  label: string;
  errorMessage?: string;
  tone: 'muted' | 'error';
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
    cell: (item) => (
      <ColumnListCell
        primary={
          <span className="inline-flex min-w-0 items-center gap-2">
            <span className="truncate">{item.name}</span>
            {item.pathIssue && <PathIssueChip issue={item.pathIssue} path={item.path} />}
            {item.runtimePhase && (
              <RuntimePhaseLabel phase={item.runtimePhase} operation={item.hostOperation} />
            )}
            {!item.runtimePhase && item.hostOperation && (
              <HostOperationChip operation={item.hostOperation} />
            )}
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

export const LocalWorkspaceDetailPage = observer(function LocalWorkspaceDetailPage({
  detailId,
  closeDetail,
}: SettingsPageDetailProps) {
  const queryClient = useQueryClient();
  const openConfirm = useOpenModal('confirmActionModal');
  const workspaceQuery = useLocalWorkspaces(true);
  const operationTrees = useOperationTrees(detailId, getMachineOperationsClient);
  const hostOperationRecords = useWorkspaceOperationRecords();
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
  const aggregateStatus = aggregateWorkspaceStatus(rowStatuses) satisfies WorkspaceIconStatus;
  const rootRow = rows.find((row) => row.kind === 'root') ?? rows[0];
  const busyPaths = useMemo(
    () => operationWorkspacePaths(operationTrees.trees),
    [operationTrees.trees]
  );
  const operationByPath = useMemo(
    () => operationLinkByPath(operationTrees.trees),
    [operationTrees.trees]
  );
  const hostOperationByPath = useMemo(
    () => operationChecklistByPath(hostOperationRecords),
    [hostOperationRecords]
  );
  const workspacePaths = useMemo(() => new Set(rows.map((row) => row.path)), [rows]);
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
        operation: operationByPath.get(row.path),
        hostOperation: hostOperationByPath.get(row.path),
        runtimePhase: runtimePhaseDisplay(
          workspacePhase(row, statuses),
          workspaceRuntimeErrorMessage(row, statuses)
        ),
      })
    );

  const handleDelete = useCallback(async () => {
    if (!group) return;
    const allDeletableRows = group.workspaces.filter((row) => row.canDelete);
    const deletableRows = allDeletableRows.filter((row) => !busyPaths.has(row.path));
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
  }, [busyPaths, closeDetail, group, openConfirm, queryClient]);

  if (workspaceQuery.isLoading) return <DetailLoadingState />;
  if (workspaceQuery.isError) return <DetailErrorState error={workspaceQuery.error} />;
  if (!group || !rootRow) return <DetailMissingState />;

  return (
    <TooltipProvider delay={150}>
      <div className="flex min-h-0 flex-col gap-6 pb-4">
        <RepositoryHeader
          project={group.project}
          rootRow={rootRow}
          rows={rows}
          status={aggregateStatus}
          usage={usageByPath.get(rootRow.path)}
          gitStats={gitStatsByPath.get(rootRow.path)}
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

        <WorkspaceOperationsPanel records={hostOperationRecords} paths={workspacePaths} />

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
  row,
  status,
  usageByPath,
  gitStatsByPath,
  loadingUsage,
  loadingGitStats,
  operation,
  runtimePhase,
  hostOperation,
}: {
  row: ProjectWorkspaceRow;
  status: WorkspaceIconStatus;
  usageByPath: Map<string, ProjectWorkspaceUsage>;
  gitStatsByPath: Map<string, ProjectWorkspaceGitStats>;
  loadingUsage: boolean;
  loadingGitStats: boolean;
  operation: WorkspaceOperationLink | undefined;
  runtimePhase: WorkspaceRuntimePhaseDisplay | undefined;
  hostOperation: WorkspaceOperationRecord | undefined;
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
    operation,
    runtimePhase,
    ...(hostOperation ? { hostOperation } : {}),
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

function RuntimePhaseLabel({
  phase,
  operation,
}: {
  phase: WorkspaceRuntimePhaseDisplay;
  operation?: WorkspaceOperationRecord;
}) {
  const label = (
    <span
      className={
        phase.tone === 'error'
          ? 'shrink-0 text-xs text-foreground-destructive'
          : 'shrink-0 text-xs text-foreground-muted'
      }
    >
      {phase.label}
    </span>
  );
  if (!phase.errorMessage && !operation) return label;
  return (
    <Tooltip>
      <TooltipTrigger>{label}</TooltipTrigger>
      <TooltipContent className="max-w-96 text-xs">
        {operation ? <OperationStageChecklist record={operation} /> : phase.errorMessage}
      </TooltipContent>
    </Tooltip>
  );
}

function HostOperationChip({ operation }: { operation: WorkspaceOperationRecord }) {
  return (
    <Tooltip>
      <TooltipTrigger>
        <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] tracking-wide text-foreground-muted uppercase">
          {workspaceOperationKindLabel(operation.kind)}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-96 text-xs">
        <OperationStageChecklist record={operation} />
      </TooltipContent>
    </Tooltip>
  );
}

function runtimePhaseDisplay(
  phase: ReturnType<typeof workspacePhase>,
  errorMessage: string | undefined
): WorkspaceRuntimePhaseDisplay | undefined {
  if (
    phase === undefined ||
    phase === 'ready' ||
    phase === 'active' ||
    phase === 'provisioned' ||
    phase === 'unprovisioned'
  ) {
    return undefined;
  }
  return {
    label: workspacePhaseLabel(phase),
    errorMessage,
    tone: phase === 'broken' ? 'error' : 'muted',
  };
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

function operationLinkByPath(trees: readonly OperationTree[]): Map<string, WorkspaceOperationLink> {
  const links = new Map<string, WorkspaceOperationLink>();
  for (const tree of trees) {
    for (const node of [tree.root, ...tree.children]) {
      if (node.workspacePath) links.set(node.workspacePath, { node, root: tree.root });
    }
  }
  return links;
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
  return `Part of ${operationKindLabel(operation.root.operationKind)} "${rootName}", ${relativeQueuedTime(
    operation.root.createdAt
  )}`;
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

function formatCount(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
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
