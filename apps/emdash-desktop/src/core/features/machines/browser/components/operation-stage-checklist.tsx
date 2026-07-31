import {
  isTerminalStatus,
  type WorkspaceOperationRecord,
} from '@emdash/core/runtimes/workspace/api';
import { CheckIcon, CircleIcon, MinusIcon, XIcon, type LucideIcon } from 'lucide-react';
import { Spinner } from '@core/primitives/ui/browser/spinner';
import {
  relativeQueuedTime,
  relativeTime,
} from '@core/services/operations/browser/operation-trees-panel';

export function OperationStageChecklist({ record }: { record: WorkspaceOperationRecord }) {
  return (
    <div className="flex min-w-64 flex-col gap-2 text-xs">
      <div>
        <div className="font-medium text-foreground">
          {workspaceOperationKindLabel(record.kind)}
        </div>
        <div className="text-foreground-muted">{operationTimelineSummary(record)}</div>
      </div>
      <OperationStageList record={record} />
    </div>
  );
}

/** Submitted time while in flight; settled time once the operation is done. */
function operationTimelineSummary(record: WorkspaceOperationRecord): string {
  if (!isTerminalStatus(record.status) || record.finishedAt === undefined) {
    return relativeQueuedTime(record.createdAt);
  }
  return `settled ${relativeTime(record.finishedAt)}`;
}

export function OperationStageList({ record }: { record: WorkspaceOperationRecord }) {
  const stages = record.stages?.stages ?? [];
  if (stages.length === 0) {
    return <div className="text-xs text-foreground-muted">{emptyStageMessage(record)}</div>;
  }
  return (
    <div className="flex flex-col gap-1.5 text-xs">
      {stages.map((stage) => (
        <div key={stage.id} className="flex min-w-0 items-start gap-2">
          <StageStatusIcon status={stage.status} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-foreground">{stage.label}</div>
            {stage.progress?.percent !== undefined && (
              <div className="text-foreground-muted">{stage.progress.percent}%</div>
            )}
            {stage.progress?.message && (
              <div className="truncate text-foreground-muted">{stage.progress.message}</div>
            )}
            {stage.status === 'failed' && record.error?.message && (
              <div className="text-foreground-destructive">{record.error.message}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Stages are only written while an operation runs, so a queued record has none. */
function emptyStageMessage(record: WorkspaceOperationRecord): string {
  if (record.status === 'pending') return 'Queued - the host has not started this yet';
  return 'Waiting for operation stages...';
}

export function workspaceOperationKindLabel(kind: WorkspaceOperationRecord['kind']): string {
  switch (kind) {
    case 'provision':
      return 'Provisioning workspace';
    case 'convert':
      return 'Converting workspace';
    case 'activate':
      return 'Activating workspace';
    case 'deactivate':
      return 'Deactivating workspace';
    case 'teardown':
      return 'Tearing down workspace';
    case 'clean-artifacts':
      return 'Cleaning artifacts';
  }
}

function StageStatusIcon({
  status,
}: {
  status: NonNullable<WorkspaceOperationRecord['stages']>['stages'][number]['status'];
}) {
  switch (status) {
    case 'running':
      return <Spinner className="mt-0.5 size-3 shrink-0 text-foreground-warning" />;
    case 'done':
      return <StatusIcon icon={CheckIcon} className="text-foreground-success" />;
    case 'skipped':
      return <StatusIcon icon={MinusIcon} className="text-foreground-muted" />;
    case 'failed':
      return <StatusIcon icon={XIcon} className="text-foreground-destructive" />;
    case 'pending':
      return <StatusIcon icon={CircleIcon} className="text-foreground-muted" />;
  }
}

function StatusIcon({ icon: Icon, className }: { icon: LucideIcon; className: string }) {
  return <Icon className={`mt-0.5 size-3 shrink-0 ${className}`} />;
}
