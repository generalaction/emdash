import {
  ColumnList,
  ColumnListCell,
  WorkspaceIcon,
  type ColumnListColumn,
  type WorkspaceIconStatus,
  type WorkspaceIconType,
} from '@emdash/ui/react/components';
import { Spinner, toast, Tooltip } from '@emdash/ui/react/primitives';
import { WifiOffIcon } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, type ReactNode } from 'react';
import { WorkspaceRemovalAttentionPanel } from '@core/features/workspaces/api/browser/removal-attention-panel';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import type { SettingsPageDetailProps } from '@core/primitives/settings/api/page-contribution';
import { RelativeTime } from '@core/primitives/ui/browser/relative-time';
import type {
  ProjectWorkspaceGitStats,
  ProjectWorkspacePathIssue,
  ProjectWorkspaceRow,
  ProjectWorkspaceUsage,
} from '@core/primitives/workspaces/api';
import { GitStatsCell } from '../components/git-stats-cell';
import { RepositoryHeader } from '../components/local-workspace-header';
import { basename, formatBytes } from '../components/workspace-format';
import { deleteMachineProjectWorkspaces } from '../use-machine-workspaces';
import { useWorkspaceRows, type WorkspacesScope } from '../use-workspace-rows';
import type { JoinedWorkspaceRow } from '../workspace-rows';
import { aggregateWorkspaceStatus } from '../workspace-runtime-status';

/** One durable script failure (mirror `scriptOutcomes`) or a live overlay notice. */
type WorkspaceScriptIssue = {
  script: string;
  outcome: 'failed' | 'timed-out';
  at: number;
  message?: string;
};

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
  pendingRemoval: boolean;
  removalNeedsAttention: boolean;
  statusMessage?: string;
  scriptIssues: WorkspaceScriptIssue[];
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
            <RemovalChip item={item} />
            {item.scriptIssues.map((issue) => (
              <ScriptIssueChip key={issue.script} issue={issue} />
            ))}
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
  const openConfirm = useOpenModal('confirmActionModal');
  const workspaceRows = useWorkspaceRows({ scope, projectId: detailId, enabled: connected });
  const { workspaceQuery, group, rows, usageQuery } = workspaceRows;
  const rowStatuses = rows.map((row) => row.status);
  const aggregateStatus = aggregateWorkspaceStatus(rowStatuses) satisfies WorkspaceIconStatus;
  const rootJoined = rows.find((joined) => joined.row.kind === 'root') ?? rows[0];
  const rootRow = rootJoined?.row;
  const worktreeItems = rows
    .filter((row) => row !== rootJoined)
    .map((joined) =>
      buildWorktreeItem({
        joined,
        loadingUsage: usageQuery.isLoading || usageQuery.isFetching,
      })
    );

  const handleDelete = useCallback(async () => {
    if (!group) return;
    // Tombstoned rows already fold into `canDelete: false` — no second delete.
    const deletableRows = group.workspaces.filter((row) => row.row.canDelete);
    if (deletableRows.length === 0) {
      const pendingCount = group.workspaces.filter((row) => row.pendingRemoval).length;
      toast(pendingCount > 0 ? 'Removal already pending' : 'No deletable workspaces', {
        description:
          pendingCount > 0
            ? 'These workspaces are already being removed.'
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
        toast.error(`${result.results.length - failed.length} deleted, ${failed.length} failed`, {
          description: failed[0]?.message,
        });
      } else {
        toast(`Deleted ${deletableRows.length} workspaces`);
        closeDetail();
      }
      // No cache invalidation: the mirror live model streams the deletions.
    } catch (error) {
      toast.error('Could not delete workspaces', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [closeDetail, group, openConfirm]);

  if (!connected) return <DetailOfflineState machineName={machineName} />;
  if (workspaceQuery.isLoading) return <DetailLoadingState />;
  if (workspaceQuery.isError) return <DetailErrorState error={workspaceQuery.error} />;
  if (!group || !rootJoined || !rootRow) return <DetailMissingState />;

  return (
    <Tooltip.Provider delay={150}>
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
          loadingGitStats={false}
          warnings={group.warnings}
          onDelete={() => void handleDelete()}
        />

        <WorkspaceRemovalAttentionPanel rows={rows.map((joined) => joined.row)} />

        <WorkspaceSection label="Worktrees">
          <ColumnList
            items={worktreeItems}
            columns={DETAIL_COLUMNS}
            getItemKey={(item) => item.id}
            emptySlot={<WorktreesEmptyState />}
          />
        </WorkspaceSection>
      </div>
    </Tooltip.Provider>
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
}: {
  joined: JoinedWorkspaceRow;
  loadingUsage: boolean;
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
    loadingGitStats: false,
    pendingRemoval: joined.pendingRemoval,
    removalNeedsAttention: joined.removalNeedsAttention,
    statusMessage: joined.statusMessage,
    scriptIssues: workspaceScriptIssues(row),
    ...(row.pathIssue ? { pathIssue: row.pathIssue } : {}),
  };
}

/**
 * One chip per script: the durable last outcome (mirror `scriptOutcomes`, survives
 * daemon restarts) is the fact of record; a live overlay notice only adds a chip for
 * a script without a durable failure yet — never a duplicate of the same failure.
 */
function workspaceScriptIssues(row: ProjectWorkspaceRow): WorkspaceScriptIssue[] {
  const issues: WorkspaceScriptIssue[] = [];
  const outcomes = row.scriptOutcomes;
  for (const script of ['prepare', 'setup', 'run'] as const) {
    const outcome = outcomes?.[script];
    if (outcome && outcome.outcome !== 'succeeded') {
      issues.push({ script, outcome: outcome.outcome, at: outcome.at, message: outcome.message });
    }
  }
  const covered = new Set(issues.map((issue) => issue.script));
  for (const notice of row.runtimeOverlay?.notices ?? []) {
    if (notice.kind !== 'script-failed' || covered.has(notice.script)) continue;
    covered.add(notice.script);
    issues.push({
      script: notice.script,
      outcome: 'failed',
      at: notice.at,
      message: notice.message,
    });
  }
  return issues;
}

function PathIssueChip({ issue, path }: { issue: ProjectWorkspacePathIssue; path: string }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger>
        <span className={pathIssueChipClass(issue)}>
          {issue.kind === 'prunable' ? 'Stale git record' : 'Missing'}
        </span>
      </Tooltip.Trigger>
      <Tooltip.Content className="max-w-80 text-xs">
        {pathIssueMessage(issue, path)}
      </Tooltip.Content>
    </Tooltip.Root>
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

/** Pending-deletion treatment: the tombstoned row is its own visible state (ADR 0006). */
function RemovalChip({ item }: { item: WorkspaceDetailListItem }) {
  if (!item.pendingRemoval) return null;
  const chipBase = 'shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] tracking-wide uppercase';
  if (item.removalNeedsAttention) {
    return (
      <Tooltip.Root>
        <Tooltip.Trigger>
          <span className={`${chipBase} border-border-destructive text-foreground-destructive`}>
            Removal failed
          </span>
        </Tooltip.Trigger>
        <Tooltip.Content className="max-w-70 text-xs">
          {item.statusMessage ?? 'The removal stopped after a failure that needs your decision.'}
        </Tooltip.Content>
      </Tooltip.Root>
    );
  }
  return (
    <span className={`${chipBase} animate-pulse border-border-warning text-foreground-warning`}>
      Removing…
    </span>
  );
}

function ScriptIssueChip({ issue }: { issue: WorkspaceScriptIssue }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger>
        <span className="shrink-0 rounded-full border border-border-warning px-1.5 py-0.5 text-[10px] tracking-wide text-foreground-warning uppercase">
          {scriptIssueLabel(issue)}
        </span>
      </Tooltip.Trigger>
      <Tooltip.Content className="max-w-80 text-xs">
        {scriptIssueLabel(issue)} <RelativeTime value={issue.at} />
        {issue.message ? `: ${issue.message}` : ''}
      </Tooltip.Content>
    </Tooltip.Root>
  );
}

function scriptIssueLabel(issue: WorkspaceScriptIssue): string {
  const script = issue.script[0]!.toUpperCase() + issue.script.slice(1);
  return `${script} ${issue.outcome === 'timed-out' ? 'timed out' : 'failed'}`;
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
      <Spinner size="sm" />
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
