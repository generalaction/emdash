import {
  isTerminalStatus,
  type WorkspaceOperationRecord,
  type WorkspaceOperationRecordMap,
  type WorkspaceOperationRecordStatus,
} from '@emdash/core/runtimes/workspace/api';
import { AlertTriangleIcon, ListChecksIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { nativePathFromHost } from '@core/primitives/desktop-runtime/api';
import { cn } from '@core/primitives/ui/browser/cn';
import {
  relativeQueuedTime,
  relativeTime,
} from '@core/services/operations/browser/operation-trees-panel';
import { workspaceOperationPanelRecords } from '../use-machine-workspaces';
import { OperationStageList, workspaceOperationKindLabel } from './operation-stage-checklist';
import { basename } from './workspace-format';

const TIMELINE_REFRESH_MS = 30_000;

export function WorkspaceOperationsPanel({
  records,
  paths,
  className,
}: {
  records: WorkspaceOperationRecordMap;
  paths: ReadonlySet<string>;
  className?: string;
}) {
  const visible = workspaceOperationPanelRecords(records, { paths });
  // The host stops publishing once every operation settles, so relative labels
  // like "just now" would otherwise freeze.
  useNowTicker(TIMELINE_REFRESH_MS, visible.length > 0);
  if (visible.length === 0) return null;
  const attention = visible.some(needsAttention);

  return (
    <section
      className={cn(
        'overflow-hidden rounded-md border',
        attention
          ? 'border-border-warning bg-background-warning/30'
          : 'border-border bg-background-secondary/40',
        className
      )}
    >
      <div
        className={cn(
          'flex items-start gap-2 border-b px-3 py-2',
          attention ? 'border-border-warning/50' : 'border-border'
        )}
      >
        {attention ? (
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-foreground-warning" />
        ) : (
          <ListChecksIcon className="mt-0.5 size-4 shrink-0 text-foreground-muted" />
        )}
        <div>
          <h2 className="text-sm font-medium text-foreground">Host operations</h2>
          <p className="text-xs text-foreground-muted">
            Workspace work the host is running, with per-stage progress.
          </p>
        </div>
      </div>
      <div
        className={cn(
          'max-h-80 divide-y overflow-y-auto',
          attention ? 'divide-border-warning/40' : 'divide-border'
        )}
      >
        {visible.map((record) => (
          <OperationRecordRow key={record.requestId} record={record} />
        ))}
      </div>
    </section>
  );
}

function OperationRecordRow({ record }: { record: WorkspaceOperationRecord }) {
  const path = nativePathFromHost(record.workspace.path);
  return (
    <article className="px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium text-foreground">
          {workspaceOperationKindLabel(record.kind)}
        </span>
        <span className="truncate text-foreground">{basename(path)}</span>
        <span className={statusPillClass(record.status)}>{statusLabel(record.status)}</span>
        <span className="text-foreground-muted" title={timelineTooltip(record)}>
          {timelineLabel(record)}
        </span>
        {record.attempt > 0 && (
          <span className="text-foreground-muted">attempt {record.attempt + 1}</span>
        )}
      </div>
      <div className="mt-0.5 truncate text-foreground-muted">{path}</div>
      {record.suspendedCause && (
        <div className="mt-0.5 text-foreground-warning">Paused: {record.suspendedCause}</div>
      )}
      {record.error && (
        <div className="mt-0.5 text-foreground-destructive">{record.error.message}</div>
      )}
      <div className="mt-1.5">
        <OperationStageList record={record} />
      </div>
    </article>
  );
}

/**
 * Re-renders on an interval while the view depends on wall-clock time. Callers
 * read the clock during render, so there is no cached timestamp to go stale.
 */
function useNowTicker(intervalMs: number, enabled: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setTick((tick) => tick + 1), intervalMs);
    return () => clearInterval(timer);
  }, [enabled, intervalMs]);
}

function timelineLabel(record: WorkspaceOperationRecord): string {
  if (!isTerminalStatus(record.status) || record.finishedAt === undefined) {
    return relativeQueuedTime(record.createdAt);
  }
  return `${settledVerb(record.status)} ${relativeTime(record.finishedAt)} · took ${formatDuration(
    record.finishedAt - record.createdAt
  )}`;
}

function timelineTooltip(record: WorkspaceOperationRecord): string {
  const lines = [`Queued ${new Date(record.createdAt).toLocaleString()}`];
  if (record.finishedAt !== undefined) {
    lines.push(`Finished ${new Date(record.finishedAt).toLocaleString()}`);
  }
  return lines.join('\n');
}

function settledVerb(status: WorkspaceOperationRecordStatus): string {
  switch (status) {
    case 'succeeded':
      return 'finished';
    case 'failed':
      return 'failed';
    case 'rejected':
      return 'rejected';
    case 'cancelled':
      return 'cancelled';
    case 'suspended':
      return 'paused';
    case 'pending':
    case 'running':
      return 'finished';
  }
}

export function formatDuration(durationMs: number): string {
  const clamped = Math.max(0, durationMs);
  if (clamped < 1000) return '<1s';
  const seconds = Math.floor(clamped / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (remainingSeconds === 0) return `${minutes}m`;
  return `${minutes}m ${remainingSeconds}s`;
}

function needsAttention(record: WorkspaceOperationRecord): boolean {
  return (
    record.status === 'failed' || record.status === 'rejected' || record.status === 'suspended'
  );
}

function statusLabel(status: WorkspaceOperationRecordStatus): string {
  switch (status) {
    case 'pending':
      return 'Queued';
    case 'running':
      return 'Running';
    case 'succeeded':
      return 'Succeeded';
    case 'failed':
      return 'Failed';
    case 'rejected':
      return 'Rejected';
    case 'cancelled':
      return 'Cancelled';
    case 'suspended':
      return 'Paused';
  }
}

function statusPillClass(status: WorkspaceOperationRecordStatus): string {
  const base = 'rounded-full border px-1.5 py-0.5 text-[10px] tracking-wide uppercase';
  switch (status) {
    case 'pending':
    case 'cancelled':
      return `${base} border-border text-foreground-muted`;
    case 'running':
      return `${base} border-border-info text-foreground-info`;
    case 'succeeded':
      return `${base} border-border-success text-foreground-success`;
    case 'suspended':
      return `${base} border-border-warning text-foreground-warning`;
    case 'failed':
    case 'rejected':
      return `${base} border-border-destructive text-foreground-destructive`;
  }
}
