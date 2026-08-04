import type { OperationTree } from '@emdash/core/primitives/operations/api';
import { WorkspaceIcon, type WorkspaceIconStatus } from '@emdash/ui/react/components';
import { Button, DropdownMenu } from '@emdash/ui/react/primitives';
import { AlertTriangleIcon, EllipsisIcon, Trash2Icon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@core/primitives/ui/browser/tooltip';
import type {
  ProjectWorkspaceGitStats,
  ProjectWorkspaceRow,
  ProjectWorkspaceUsage,
} from '@core/primitives/workspaces/api';
import { worstRollupStatus } from '@core/services/operations/browser/operation-trees-panel';
import { GitStatsCell } from './git-stats-cell';
import { basename, formatBytes } from './workspace-format';

export function RepositoryHeader({
  project,
  rootRow,
  rows,
  status,
  usage,
  gitStats,
  loadingUsage,
  loadingGitStats,
  operationTrees,
  warnings,
  onDelete,
}: {
  project: { id: string; name: string };
  rootRow: ProjectWorkspaceRow;
  rows: readonly ProjectWorkspaceRow[];
  status: WorkspaceIconStatus;
  usage: ProjectWorkspaceUsage | undefined;
  gitStats: ProjectWorkspaceGitStats | undefined;
  loadingUsage: boolean;
  loadingGitStats: boolean;
  operationTrees: readonly OperationTree[];
  warnings: readonly string[];
  onDelete(): void;
}) {
  const healthStatus = status;
  const issueRows = pathIssueRows(rows);
  const issueSummary = pathIssueSummary(issueRows);
  const rollupStatus = worstRollupStatus(operationTrees);

  return (
    <section className="rounded-lg border border-border bg-background-secondary/40 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <WorkspaceIcon type="repository" status={healthStatus} size="2.75rem" />
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-semibold text-foreground">{project.name}</h2>
              {healthStatus !== 'idle' && (
                <span className={runtimeStatusPillClass(healthStatus)}>
                  {runtimeStatusLabel(healthStatus)}
                </span>
              )}
              {issueSummary && <PathIssueSummaryPill rows={issueRows} summary={issueSummary} />}
              {rollupStatus && (
                <span className={operationPillClass(rollupStatus)}>
                  {operationPillLabel(rollupStatus, operationTrees.length)}
                </span>
              )}
            </div>
            <div className="mt-0.5 truncate text-xs text-foreground-muted">{rootRow.path}</div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-foreground-muted">
              <span>{rootRow.branch ?? 'No branch'}</span>
              <span>
                <GitStatsCell stats={gitStats} loading={loadingGitStats} />
              </span>
              <span>{usageLabel(usage, loadingUsage)}</span>
              {usage && <span>{formatBytes(usage.artifactBytes)} artifacts</span>}
              <span>{syncLabel(rootRow.lastObservedAt)}</span>
            </div>
          </div>
        </div>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            <Button type="button" variant="ghost" size="sm" icon aria-label="Workspace actions">
              <EllipsisIcon aria-hidden />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end">
            <DropdownMenu.Item variant="destructive" onClick={onDelete}>
              <Trash2Icon aria-hidden />
              Delete
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>
      <WorkspaceScanWarnings warnings={warnings} />
    </section>
  );
}

function usageLabel(usage: ProjectWorkspaceUsage | undefined, loading: boolean): string {
  if (usage) return formatBytes(usage.totalBytes);
  return loading ? 'Loading usage...' : 'Usage unavailable';
}

function syncLabel(lastObservedAt: string | undefined): string {
  if (!lastObservedAt) return 'Not synced yet';
  const timestamp = Date.parse(lastObservedAt);
  if (!Number.isFinite(timestamp)) return 'Sync time unknown';
  const elapsedMs = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return 'Synced just now';
  if (minutes < 60) return `Synced ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Synced ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `Synced ${days}d ago`;
}

function runtimeStatusLabel(status: WorkspaceIconStatus): string {
  switch (status) {
    case 'active':
      return 'Active';
    case 'setting-up':
      return 'Setting up';
    case 'tearing-down':
      return 'Tearing down';
    case 'error':
      return 'Error';
    case 'idle':
      return 'Idle';
  }
}

function pathIssueRows(rows: readonly ProjectWorkspaceRow[]): ProjectWorkspaceRow[] {
  return rows.filter((row) => row.pathIssue !== undefined);
}

function pathIssueSummary(rows: readonly ProjectWorkspaceRow[]): string | undefined {
  if (rows.length === 0) return undefined;
  const [first] = rows;
  if (rows.length === 1 && first?.pathIssue) {
    return first.pathIssue.kind === 'prunable'
      ? `${worktreeLabel(first)} has a stale git record`
      : `${worktreeLabel(first)} missing`;
  }
  return `${rows.length} worktrees need attention`;
}

function PathIssueSummaryPill({
  rows,
  summary,
}: {
  rows: readonly ProjectWorkspaceRow[];
  summary: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger>
        <span className="rounded-full border border-border-warning px-2 py-0.5 text-[10px] tracking-wide text-foreground-warning uppercase">
          {summary}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-96 text-xs">
        <div className="flex flex-col gap-1">
          {rows.map((row) => (
            <div key={`${row.workspaceId ?? row.path}:${row.path}`} className="min-w-0">
              <div className="font-medium">{worktreeLabel(row)}</div>
              <div className="text-foreground-muted">{pathIssueMessage(row)}</div>
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function WorkspaceScanWarnings({ warnings }: { warnings: readonly string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="mt-3 flex items-start gap-2 rounded-md border border-border-warning bg-background-warning px-3 py-2 text-xs text-foreground-warning">
      <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">Workspace scan completed with warnings</div>
        <div className="truncate text-foreground-warning/80">{warnings.join(' ')}</div>
      </div>
    </div>
  );
}

function worktreeLabel(row: ProjectWorkspaceRow): string {
  return row.branch ?? basename(row.path);
}

function pathIssueMessage(row: ProjectWorkspaceRow): string {
  if (!row.pathIssue) return 'Workspace path needs attention.';
  if (row.pathIssue.reason) return row.pathIssue.reason;
  if (row.pathIssue.kind === 'prunable') return 'Git reports this worktree as prunable.';
  return `Directory not found at ${row.path}.`;
}

function runtimeStatusPillClass(status: WorkspaceIconStatus): string {
  const base = 'rounded-full border px-2 py-0.5 text-[10px] tracking-wide uppercase';
  switch (status) {
    case 'active':
      return `${base} border-border-success text-foreground-success`;
    case 'setting-up':
      return `${base} border-border-info text-foreground-info`;
    case 'tearing-down':
      return `${base} border-border-warning text-foreground-warning`;
    case 'error':
      return `${base} border-border-destructive text-foreground-destructive`;
    case 'idle':
      return base;
  }
}

function operationPillLabel(status: ReturnType<typeof worstRollupStatus>, count: number): string {
  const suffix = count === 1 ? 'operation' : 'operations';
  switch (status) {
    case 'failed':
      return `${count} ${suffix} failed`;
    case 'awaiting-confirmation':
      return `${count} ${suffix} need attention`;
    case 'blocked-host-offline':
      return 'Host offline';
    case 'running':
      return `${count} ${suffix} running`;
    case 'queued':
      return `${count} ${suffix} queued`;
    case 'waiting':
      return `${count} ${suffix} waiting`;
    case undefined:
      return '';
  }
}

function operationPillClass(status: ReturnType<typeof worstRollupStatus>): string {
  const base = 'rounded-full border px-2 py-0.5 text-[10px] tracking-wide uppercase';
  switch (status) {
    case 'failed':
      return `${base} border-border-destructive text-foreground-destructive`;
    case 'awaiting-confirmation':
    case 'blocked-host-offline':
    case 'waiting':
      return `${base} border-border-warning text-foreground-warning`;
    case 'queued':
    case 'running':
      return `${base} border-border text-foreground-muted`;
    case undefined:
      return base;
  }
}
